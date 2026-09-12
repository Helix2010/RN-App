import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "ethers";
import type { KeyValueStorage } from "../../gateways/types";
import { fromBase64, toBase64 } from "./base64";
import {
  accountFromPrivateKey,
  deriveAccount,
  generateMnemonic,
  normalizeMnemonic,
  normalizePrivateKey,
  type MnemonicWordCount,
} from "../keygen/mnemonic";
import {
  authenticateOverrideAllowed,
  platformAuthenticate,
} from "./platform-authenticate";
import type {
  AuthenticatePort,
  AuthenticatedSecureStorePort,
  SecureStorePort,
} from "./ports";
import {
  derivePassKeyFor,
  newDeviceKey,
  openWrapKey,
  sealWrapKey,
  type WrapKeyEnvelope,
} from "./wrap-key-envelope";
import { assertPassphraseAcceptable } from "./passphrase";

/**
 * 自托管密钥的静止态保管。分层与 Robinhood 一致（逆向 E-011）：
 *
 *   助记词/私钥 --AES-256-GCM--> 密文存普通存储（AsyncStorage）
 *   加密密钥    --HKDF-SHA256--> 由包裹密钥 WK + 每条目 salt 派生
 *   WK          -------------->  存系统硬件密钥库（Keystore / Keychain）
 *   解封 / 签名  -------------->  必须先过生物识别（门控在边界内部，不靠调用方自觉）
 *
 * 明文助记词与私钥永不落盘、不进日志。私钥只在 `withPrivateKey` 的回调作用域内
 * 存在，不会作为返回值离开本模块。
 *
 * 失败语义（安全评审 N7/N8/N35，2026-09-10）：
 * - vault 文件读不出来就是错误（`WalletVaultCorruptedError`），不会被当成空 vault
 *   再被下一次写入覆盖；任何会替换原文件的操作先把原始内容归档到
 *   `foundation.wallet.vault.v1.corrupt.<ISO 时间>`。
 * - 文件里已有条目而密钥库里没有 WK（重装、Keystore 失效），或 WK 与文件登记的
 *   校验值不符，是 `WalletVaultKeyMissingError`：不铸新 WK、不静默换钥。
 * - 所有写入经同一实例的串行队列，读→取 WK→写 之间不会被另一次写入插队；
 *   "非空 vault 加账户必须认证"的判定也在队列里做，两个并发的添加不会都以为 vault 是空的。
 * - 没有 `wkCheck` 的老文件解不开（GCM 认证失败）视为 WK 不匹配（`KeyMissing`），
 *   而不是笼统的"解不开"：这正是修复前 N8 静默换钥留下的存量状态，必须能进恢复流程。
 */

const WRAP_KEY_STORE_KEY = "foundation.wallet.wrap-key.v1";
/**
 * 开了口令保护之后 WK 的两份封装（安全评审 N6 / 方案 §3.5）。
 *
 * A 路 = 认证绑定的 SecureStore 条目（读它会弹系统验证，JS 绕不开）。
 * B 路 = 普通存储里的信封 + 未认证 SecureStore 里的设备密钥。
 *
 * 不变量：**两份永远是同一把 WK**，任何铸造或轮换都必须同时写两份。
 */
const WRAP_KEY_ENVELOPE_STORAGE_KEY = "foundation.wallet.wrap-key-envelope.v1";
const ENVELOPE_DEVICE_KEY_STORE_KEY = "foundation.wallet.envelope-key.v1";
/**
 * vault 文件：`{ version: 1, entries, wkCheck? }`。
 * `wkCheck` = HKDF-SHA256(WK, salt="foundation.wallet.wk-check.v1") 前 8 字节的
 * base64，用来在解密前认出"密钥库里的 WK 不是加密这份文件的那把"。老文件没有这个
 * 字段，会在下一次成功解密（GCM 认证通过，证明 WK 正确）后补写。
 */
const VAULT_STORAGE_KEY = "foundation.wallet.vault.v1";
/** 读不出来的 vault 原文归档在这个前缀下，后缀是归档时刻的 ISO 时间。 */
export const VAULT_CORRUPT_BACKUP_PREFIX = `${VAULT_STORAGE_KEY}.corrupt.`;
const HKDF_INFO = new TextEncoder().encode("foundation.wallet.entry.v1");
const WK_CHECK_SALT = new TextEncoder().encode("foundation.wallet.wk-check.v1");
const WK_CHECK_LENGTH = 8;
/** 成功验证后 WK 在内存里的有效期，对应 Keystore 的认证有效期，避免每次签名都弹窗。 */
const DEFAULT_UNLOCK_TTL_MS = 5 * 60 * 1_000;

type VaultEntryKind = "mnemonic" | "private-key";

/** 对外可见的条目元数据 —— 不含任何密钥材料。 */
type VaultEntry = {
  address: string;
  kind: VaultEntryKind;
  /** mnemonic 条目的 BIP-44 路径；私钥导入为 null */
  path: string | null;
  createdAt: string;
  backedUpAt: string | null;
};

type StoredEntry = VaultEntry & {
  salt: string;
  nonce: string;
  ciphertext: string;
  /**
   * 这条密文带哪一版 AAD（附加认证数据），同时也说明**密文里装的是什么**：
   *
   * - 缺这个字段：升级前写下的老条目，解密时不带 AAD。
   * - `1`：AAD = `v1|address|kind|path`，密文装的是"原始材料"——mnemonic 条目
   *   装的是助记词本身。
   * - `2`：AAD = `v2|address|kind|path|seedId`，密文装的是**这个账户的私钥**。
   *   助记词不在这里，它单独存在 `seeds` 里（安全评审 N29 / 方案 §3.3）。
   *
   * 标记参与 AAD，所以改它会让解密直接失败，不会出现"按错误的语义解读明文"。
   */
  aad?: 1 | 2;
  /** 这个账户派生自哪一条助记词。导入的私钥没有。 */
  seedId?: string;
};

/**
 * 一条助记词。它与账户条目分开保管，是这次拆分的全部意义所在：
 *
 * - 日常签名只解一把账户私钥，**根种子再也不进 JS 堆**（安全评审 N29 第三部分）。
 *   在此之前每签一次名都要解出助记词再重新派生一遍。
 * - 拿到 WK 的攻击者只能拿到已经存在的那几把私钥，拿不到"派生未来账户"的能力，
 *   也拿不到可以离线、跨链、永久使用的那份材料。
 */
type StoredSeed = {
  id: string;
  createdAt: string;
  salt: string;
  nonce: string;
  ciphertext: string;
  /** 1 = 条目密钥是 HKDF(WK ‖ scrypt(口令))，解它必须同时有 WK 和用户口令。 */
  protected?: 1;
};

type VaultFile = {
  version: 1 | 2;
  entries: StoredEntry[];
  seeds?: StoredSeed[];
  wkCheck?: string;
};

/**
 * GCM 的附加认证数据：把条目元数据绑进密文的认证标签。
 *
 * 密文、salt、nonce 和这些元数据都躺在普通存储里。没有 AAD 时，能改存储的人
 * 可以把某条的 `kind` 从 `private-key` 改成 `mnemonic`、或者改掉 `path`，
 * 解密照样成功，只是应用会按错误的语义使用这份材料。带上 AAD 后，任何一处
 * 元数据被改，`decrypt` 直接抛错（安全评审 N9）。
 *
 * 地址另有 `assertOwner` 重算校验兜底，这里把它一并纳入认证范围。
 */
function entryAad(entry: {
  address: string;
  kind: VaultEntryKind;
  path: string | null;
}): Uint8Array {
  // 用 JSON 数组而不是分隔符拼接：拼接的话，字段里出现分隔符就可能让两组不同的
  // 元数据拼出同一个串（`a|b` + `c` 与 `a` + `b|c`），认证范围就被绕开了。
  // 解密时这些字段来自普通存储，攻击者能随便写，所以编码必须是单射的。
  //
  // `createdAt` / `backedUpAt` 故意不在里面：`markBackedUp` 会改它们但不重新
  // 加密，放进来会让备份标记本身把条目变成解不开的。
  return new TextEncoder().encode(
    JSON.stringify(["v1", entry.address.toLowerCase(), entry.kind, entry.path]),
  );
}

/**
 * v2 条目的 AAD。比 v1 多一个 `seedId`，并且**版本号本身参与认证**——这正是
 * "密文里装的是助记词还是私钥"不会被调包的原因：把 `aad` 从 2 改成 1 会让 AAD
 * 变成另一串，解密当场失败，而不是按错误的语义读出明文。
 */
function entryAadV2(entry: {
  address: string;
  kind: VaultEntryKind;
  path: string | null;
  seedId?: string;
}): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify([
      "v2",
      entry.address.toLowerCase(),
      entry.kind,
      entry.path,
      entry.seedId ?? null,
    ]),
  );
}

function aadFor(entry: StoredEntry): Uint8Array | undefined {
  if (entry.aad === 2) return entryAadV2(entry);
  if (entry.aad === 1) return entryAad(entry);
  return undefined;
}

/** 密文里装的是什么。v2 一律是私钥；v1 的 mnemonic 条目装的是助记词。 */
function secretKindOf(entry: StoredEntry): VaultEntryKind {
  return entry.aad === 2 ? "private-key" : entry.kind;
}

const SEED_HKDF_INFO = new TextEncoder().encode("foundation.wallet.seed.v1");

function seedAad(seed: { id: string; protected?: 1 }): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify(["seed.v1", seed.id, seed.protected === 1 ? 1 : 0]),
  );
}

/**
 * 助记词条目的加密密钥。
 *
 * 开了口令保护时是 HKDF(WK ‖ scrypt(口令))：**两样都要有才解得开**。拿到 WK 的
 * 攻击者只能拿到已存在账户的私钥，想拿助记词还得去骗用户的口令，而骗口令是有
 * 声音的、会失败的、用户看得见的（方案 §3.1）。
 */
function deriveSeedKey(
  wrapKey: Uint8Array,
  passKey: Uint8Array | null,
  salt: Uint8Array,
): Uint8Array {
  const material =
    passKey === null
      ? wrapKey
      : (() => {
          const joined = new Uint8Array(wrapKey.length + passKey.length);
          joined.set(wrapKey, 0);
          joined.set(passKey, wrapKey.length);
          return joined;
        })();
  const key = hkdf(sha256, material, salt, SEED_HKDF_INFO, 32);
  if (material !== wrapKey) wipe(material);
  return key;
}

export class WalletAuthRequiredError extends Error {
  constructor(readonly outcome: "cancelled" | "failed") {
    super(`wallet authentication ${outcome}`);
    this.name = "WalletAuthRequiredError";
  }
}

export class WalletVaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletVaultError";
  }
}

/** vault 文件存在但读不出来（JSON 损坏 / 版本不认识）。原文不会被覆盖。 */
export class WalletVaultCorruptedError extends WalletVaultError {
  constructor() {
    super("stored wallet vault is corrupted or has an unknown version");
    this.name = "WalletVaultCorruptedError";
  }
}

/** vault 里有条目，但密钥库里没有能解开它们的 WK。必须从备份恢复，不会铸新。 */
/**
 * 需要口令才能继续，但当前没有可用的输入渠道（没接 `requestPassphrase`，或用户
 * 取消了输入）。**不是**"口令错了"——那是 `WalletPassphraseError`。
 */
export class WalletPassphraseRequiredError extends WalletVaultError {
  constructor() {
    super("wallet passphrase is required to unlock this vault");
    this.name = "WalletPassphraseRequiredError";
  }
}

export class WalletVaultKeyMissingError extends WalletVaultError {
  constructor(readonly kind: "missing" | "mismatch") {
    super(
      kind === "missing"
        ? "wrap key is missing for an existing wallet vault"
        : "wrap key does not match the wallet vault",
    );
    this.name = "WalletVaultKeyMissingError";
  }
}

function wipe(bytes: Uint8Array): void {
  bytes.fill(0);
}

type KeystoreVaultDeps = {
  storage: KeyValueStorage;
  secureStore: SecureStorePort;
  /**
   * 只在测试构建里生效。发布构建一律用平台实现，忽略这里传进来的东西——
   * 认证是**不可注入**的能力（安全评审 N6）。
   */
  authenticate?: AuthenticatePort;
  /**
   * 认证绑定的安全存储（方案 §3.5 的 A 路）。不传 = 这台设备上不开 A 路，
   * WK 只走 B 路（口令）。**不传不是错误**：设备没录入生物识别时本来就只有 B 路。
   */
  authenticatedStore?: AuthenticatedSecureStorePort;
  /** 向用户要口令。返回 null = 用户取消。不接 = 开不了口令保护，也解不开已开的。 */
  requestPassphrase?: RequestPassphrasePort;
  unlockTtlMs?: number;
  now?: () => number;
};

export type RequestPassphrasePort = (
  purpose: "unlock" | "enable",
) => Promise<string | null>;

export class KeystoreVault {
  private cachedWrapKey: Uint8Array | null = null;
  private cachedUntil = 0;
  private readonly unlockTtlMs: number;
  private readonly now: () => number;
  /** 所有会写 vault 文件的操作排在这条队列上，读→取 WK→写 对同一实例是原子的。 */
  private queue: Promise<unknown> = Promise.resolve();

  /** 真正用来弹认证的那个实现；发布构建里它永远是平台实现。 */
  private readonly authenticatePort: AuthenticatePort;

  constructor(private readonly deps: KeystoreVaultDeps) {
    this.unlockTtlMs = deps.unlockTtlMs ?? DEFAULT_UNLOCK_TTL_MS;
    this.now = deps.now ?? Date.now;
    this.authenticatePort =
      deps.authenticate && authenticateOverrideAllowed()
        ? deps.authenticate
        : platformAuthenticate;
  }

  /** 丢弃内存中的包裹密钥；应用进入后台或上锁时调用。 */
  lock(): void {
    if (this.cachedWrapKey) wipe(this.cachedWrapKey);
    this.cachedWrapKey = null;
    this.cachedUntil = 0;
  }

  async list(): Promise<VaultEntry[]> {
    const file = await this.read();
    return file.entries.map(({ salt, nonce, ciphertext, ...entry }) => {
      void salt;
      void nonce;
      void ciphertext;
      return entry;
    });
  }

  async has(address: string): Promise<boolean> {
    const file = await this.read();
    return file.entries.some((entry) => sameAddress(entry.address, address));
  }

  /**
   * 密钥库里的 WK 是否还能解开这份 vault。不弹认证、不解密：只看 WK 是否存在，
   * 以及它与文件登记的 `wkCheck` 是否一致。空 vault 恒通过。
   */
  async verifyWrapKey(): Promise<void> {
    const file = await this.read();
    if (file.entries.length === 0) return;
    wipe(await this.loadWrapKey(file));
  }

  /**
   * 老文件（没有 `wkCheck`）无法只看校验值判断 WK 对不对，只能真的解一条：
   * 过一次身份验证，用密钥库里的 WK 解第一条目。解得开就顺手补写 `wkCheck`；
   * 解不开就是 WK 不匹配（`KeyMissing`）。有 `wkCheck` 或为空的文件不弹认证、直接返回。
   */
  async verifyLegacyWrapKey(reason: string): Promise<void> {
    const file = await this.read();
    if (file.entries.length === 0 || file.wkCheck !== undefined) return;
    await this.authenticateFresh(reason);
    const wrapKey = await this.loadWrapKey(file);
    try {
      const entry = file.entries[0]!;
      this.assertOwner(entry, this.decrypt(entry, wrapKey, file));
      await this.backfillWkCheck(wrapKey);
    } finally {
      if (wrapKey !== this.cachedWrapKey) wipe(wrapKey);
    }
  }

  /**
   * 生成新钱包（注册路径）。助记词**只在此处返回一次**给备份流程展示，
   * 之后必须经 `revealMnemonic` 并通过身份验证才能再次取得。
   * vault 里已有账户时与导入一样先过身份验证（`reason` 是弹窗文案 key）。
   */
  async createWallet(
    reason?: string,
    words?: MnemonicWordCount,
  ): Promise<{ entry: VaultEntry; mnemonic: string }> {
    // 不传按 generateMnemonic 的默认值（24 词，安全评审 N29）
    const mnemonic = generateMnemonic(words);
    const entry = await this.addSecret(mnemonic, "mnemonic", 0, reason);
    return { entry, mnemonic };
  }

  /**
   * 导入助记词。vault 里已经有账户时必须先过身份验证（`reason` 是弹窗文案），
   * 不复用签名解锁的缓存：往钱包里加账户和签名不是同一个授权。
   */
  async importMnemonic(
    phrase: string,
    index = 0,
    reason?: string,
  ): Promise<VaultEntry> {
    const normalized = normalizeMnemonic(phrase);
    // 先派生一次，无效助记词在这里就抛，不会进队列、不会写入任何东西
    deriveAccount(normalized, index);
    return this.addSecret(normalized, "mnemonic", index, reason);
  }

  async importPrivateKey(key: string, reason?: string): Promise<VaultEntry> {
    const normalized = normalizePrivateKey(key);
    accountFromPrivateKey(normalized);
    return this.addSecret(normalized, "private-key", null, reason);
  }

  /**
   * 导出助记词（备份 / 恢复）。每次都重新过身份验证，不读也不写签名用的解锁缓存：
   * 刚签完一笔交易不等于可以看助记词。
   */
  async revealMnemonic(address: string, reason: string): Promise<string> {
    const file = await this.read();
    const entry = requireEntry(file, address);
    if (entry.kind !== "mnemonic")
      throw new WalletVaultError("account was imported without a mnemonic");
    await this.authenticateFresh(reason);
    const wrapKey = await this.loadWrapKey(file);
    try {
      // v2：助记词单独存在 seeds 里，开了口令保护就还要口令。这是全文唯一几处
      // 真的需要根种子的地方之一，签名路径不经过这里。
      if (entry.aad === 2) {
        const seed = (file.seeds ?? []).find((item) => item.id === entry.seedId);
        if (!seed)
          throw new WalletVaultError(
            "this account's recovery phrase is not in this vault",
          );
        const passKey = seed.protected === 1 ? await this.seedPassKey() : null;
        try {
          const phrase = this.readSeed(seed, wrapKey, passKey, file);
          const derived = deriveAccount(phrase, pathIndex(entry.path));
          if (!sameAddress(derived.address, entry.address))
            throw new WalletVaultError(
              "stored key material does not belong to this account",
            );
          // 刚刚证明了密钥库里的 WK 就是加密这份文件的那把，老文件在这里补登记
          await this.backfillWkCheck(wrapKey);
          return phrase;
        } finally {
          if (passKey) wipe(passKey);
        }
      }
      // 还没升级的老条目：密文里装的就是助记词
      const secret = this.decrypt(entry, wrapKey, file);
      this.assertOwner(entry, secret);
      await this.backfillWkCheck(wrapKey);
      if (entry.aad !== 1) await this.upgradeEntryAad(entry.address, secret);
      return secret;
    } finally {
      if (wrapKey !== this.cachedWrapKey) wipe(wrapKey);
    }
  }

  /**
   * 在受控作用域内使用私钥。私钥不作为返回值离开本模块，回调结束即失去引用。
   * 这是签名器唯一的取密钥入口。
   */
  async withPrivateKey<T>(
    address: string,
    reason: string,
    // 不要把这个参数叫 `use`：react-hooks 规则会把 `use(...)` 当成 React 19 的 use() hook
    consume: (privateKey: string) => T | Promise<T>,
  ): Promise<T> {
    const file = await this.read();
    const entry = requireEntry(file, address);
    const wrapKey = await this.unlock(reason, file);
    const secret = this.decrypt(entry, wrapKey, file);
    const derived = this.assertOwner(entry, secret);
    await this.backfillWkCheck(wrapKey);
    if (entry.aad === undefined)
      await this.upgradeEntryAad(entry.address, secret);
    // 老文件在这里顺手升级到 v2：这条路径上刚刚证明了 WK 是对的
    if (file.version !== 2) void this.upgradeVaultFile();
    return consume(derived.privateKey);
  }

  async markBackedUp(address: string): Promise<void> {
    await this.serialized(async () => {
      const file = await this.read();
      const entry = file.entries.find((item) =>
        sameAddress(item.address, address),
      );
      if (!entry) throw new WalletVaultError("account is not in this vault");
      entry.backedUpAt = new Date(this.now()).toISOString();
      await this.write(file);
    });
  }

  /** 从本机删除一个账户的密钥材料。独立身份验证，不复用签名缓存。 */
  async remove(address: string, reason: string): Promise<void> {
    await this.authenticateFresh(reason);
    await this.serialized(async () => {
      const file = await this.read();
      file.entries = file.entries.filter(
        (entry) => !sameAddress(entry.address, address),
      );
      // 没有任何账户再引用的助记词必须一起删掉。留着它等于"删了钱包，助记词还在
      // 设备上"——用户以为删干净了，实际上没有。
      const referenced = new Set(
        file.entries
          .map((entry) => entry.seedId)
          .filter((id): id is string => id !== undefined),
      );
      if (file.seeds)
        file.seeds = file.seeds.filter((seed) => referenced.has(seed.id));
      await this.write(file);
    });
  }

  /**
   * 清空整个 Vault 与包裹密钥（重置 / 退出并删除钱包）。独立身份验证。
   * 如果当前文件本来就读不出来，先归档原文再删，不让这次清空成为唯一副本的终点。
   */
  async wipeAll(reason: string): Promise<void> {
    await this.authenticateFresh(reason);
    await this.serialized(async () => {
      this.lock();
      const raw = await this.deps.storage.getItem(VAULT_STORAGE_KEY);
      if (raw !== null && !isVaultFile(raw)) await this.archive(raw);
      await this.deps.storage.removeItem(VAULT_STORAGE_KEY);
      await this.deps.secureStore.remove(WRAP_KEY_STORE_KEY);
    });
  }

  /**
   * 恢复流程用：把读不出来 / 解不开的 vault 文件归档到带时间戳的键下，然后清空
   * 文件位，让用户能用助记词重新导入。**不动 WK**：文件损坏时原 WK 仍可能在
   * 事后解开归档里的密文；WK 已丢失时也没有什么可删。
   */
  async archiveAndReset(reason: string): Promise<string | null> {
    await this.authenticateFresh(reason);
    return this.serialized(async () => {
      this.lock();
      const raw = await this.deps.storage.getItem(VAULT_STORAGE_KEY);
      if (raw === null) return null;
      const key = await this.archive(raw);
      await this.deps.storage.removeItem(VAULT_STORAGE_KEY);
      return key;
    });
  }

  /**
   * 往 vault 里加一条目。读文件、判断是否需要认证、认证、取 WK、写回全部在同一个
   * 串行段里：两个并发的添加不会都看到"空 vault"而一起免认证（评审 2.2）。
   * 重复地址在认证前就拒绝；非空 vault 不传 `reason` 即失败，网关不替调用方决定文案。
   */
  private addSecret(
    secret: string,
    kind: VaultEntryKind,
    index: number | null,
    reason: string | undefined,
  ): Promise<VaultEntry> {
    const account =
      kind === "mnemonic"
        ? deriveAccount(secret, index ?? 0)
        : accountFromPrivateKey(secret);
    return this.serialized(async () => {
      const file = await this.read();
      if (
        file.entries.some((item) => sameAddress(item.address, account.address))
      )
        throw new WalletVaultError("account already exists in this vault");
      if (file.entries.length > 0) {
        if (reason === undefined)
          throw new WalletVaultError(
            "adding an account to an existing vault requires authentication",
          );
        await this.authenticateFresh(reason);
      }
      const salt = randomBytes(16);
      const nonce = randomBytes(12);
      const wrapKey = await this.loadWrapKey(file);
      // 只有空 vault 的第一条目才登记 wkCheck：此时 WK 就是接下来加密它的那把。
      // 老文件（有条目、无 wkCheck）不能在这里打标记——还没证明密钥库里的 WK 解得开
      // 旧条目，标错了会把将来找回正确 WK 的用户误判成 mismatch（评审 1.5）。
      if (file.entries.length === 0) file.wkCheck = wkCheckOf(wrapKey);
      let passKey: Uint8Array | null = null;
      const entryKey = deriveEntryKey(wrapKey, salt);
      try {
        // 老文件先就地升级，不然新条目会以 v2 的形状落进一个 v1 的文件里
        this.upgradeToV2(file, wrapKey);
        let seedId: string | undefined;
        if (kind === "mnemonic") {
          // 开了口令保护就要口令：助记词条目由 HKDF(WK ‖ 口令密钥) 加密
          passKey = await this.seedPassKey();
          seedId = this.writeSeed(file, secret, wrapKey, passKey);
        }
        const metadata = {
          address: account.address,
          kind,
          path: account.path,
          ...(seedId === undefined ? {} : { seedId }),
        };
        // 条目里装的是**这个账户的私钥**，不是助记词。日常签名从此只解这一条，
        // 根种子不再每签一次名就进一次 JS 堆（安全评审 N29 / 方案 §3.3）。
        const ciphertext = gcm(entryKey, nonce, entryAadV2(metadata)).encrypt(
          new TextEncoder().encode(account.privateKey),
        );
        const entry: StoredEntry = {
          ...metadata,
          createdAt: new Date(this.now()).toISOString(),
          backedUpAt: null,
          salt: toBase64(salt),
          nonce: toBase64(nonce),
          ciphertext: toBase64(ciphertext),
          aad: 2,
        };
        file.entries.push(entry);
        await this.write(file);
        const {
          salt: _s,
          nonce: _n,
          ciphertext: _c,
          seedId: _i,
          aad: _a,
          ...visible
        } = entry;
        void _s;
        void _n;
        void _c;
        void _i;
        void _a;
        return visible;
      } finally {
        wipe(entryKey);
        if (passKey) wipe(passKey);
        if (wrapKey !== this.cachedWrapKey) wipe(wrapKey);
      }
    });
  }

  /**
   * 把 v1 文件就地升级成 v2：助记词搬进 `seeds`，账户条目改存自己那把私钥。
   *
   * **调用方必须已经持有 WK 并处在写队列里。** 纯同步，不写盘——由调用方在同一段
   * 里一起 `write`，这样"升级到一半"不会落盘。
   */
  private upgradeToV2(file: VaultFile, wrapKey: Uint8Array): boolean {
    if (file.version === 2) return false;
    const seedIds = new Map<string, string>();
    for (const entry of file.entries) {
      const secret = this.decrypt(entry, wrapKey, file);
      if (entry.kind === "mnemonic") {
        let seedId = seedIds.get(secret);
        if (seedId === undefined) {
          // 升级时一律先存成不带口令的：口令保护是之后由用户开启的，
          // `enablePassphrase` 会把这些条目重新加密一遍
          seedId = this.writeSeed(file, secret, wrapKey, null);
          seedIds.set(secret, seedId);
        }
        const derived = deriveAccount(secret, pathIndex(entry.path));
        if (!sameAddress(derived.address, entry.address))
          throw new WalletVaultError(
            "stored key material does not belong to this account",
          );
        this.rewriteAsV2(entry, derived.privateKey, wrapKey, seedId);
      } else {
        // 私钥条目本来装的就是私钥，只是换一版 AAD
        this.rewriteAsV2(entry, normalizePrivateKey(secret), wrapKey, undefined);
      }
    }
    file.version = 2;
    return true;
  }

  private rewriteAsV2(
    entry: StoredEntry,
    privateKey: string,
    wrapKey: Uint8Array,
    seedId: string | undefined,
  ): void {
    const salt = randomBytes(16);
    const nonce = randomBytes(12);
    entry.seedId = seedId;
    entry.aad = 2;
    const entryKey = deriveEntryKey(wrapKey, salt);
    try {
      entry.ciphertext = toBase64(
        gcm(entryKey, nonce, entryAadV2(entry)).encrypt(
          new TextEncoder().encode(privateKey),
        ),
      );
      entry.salt = toBase64(salt);
      entry.nonce = toBase64(nonce);
    } finally {
      wipe(entryKey);
    }
  }

  /** 顺手把老文件升级到 v2。失败不影响本次操作，与 `upgradeEntryAad` 同一个约定。 */
  private async upgradeVaultFile(): Promise<void> {
    try {
      await this.serialized(async () => {
        const file = await this.read();
        if (file.version === 2) return;
        const wrapKey = await this.loadWrapKey(file);
        try {
          if (this.upgradeToV2(file, wrapKey)) await this.write(file);
        } finally {
          if (wrapKey !== this.cachedWrapKey) wipe(wrapKey);
        }
      });
    } catch {
      // 升级是顺手做的，不是用户要的结果
    }
  }

  /**
   * 用给定 WK 解一条目。
   * - 文件登记了 `wkCheck` 且已核对通过：解不开只能是密文坏了，报笼统的"解不开"。
   * - 老文件没有 `wkCheck`：解不开最可能是密钥库里的 WK 不是当初那把（修复前 N8 的
   *   静默换钥），报 `KeyMissing(mismatch)`，让登录进入恢复流程而不是卡在"签名失败"。
   */
  /**
   * 把一条老条目重新加密成带 AAD 的形式。只在已经成功解出明文之后调用，
   * 走写队列，失败不影响本次操作（升级是顺手做的，不是用户要的结果）。
   */
  private async upgradeEntryAad(
    address: string,
    secret: string,
  ): Promise<void> {
    try {
      await this.serialized(async () => {
        const file = await this.read();
        const entry = file.entries.find((item) =>
          sameAddress(item.address, address),
        );
        if (!entry || entry.aad === 1) return;
        const wrapKey = await this.loadWrapKey(file);
        const salt = randomBytes(16);
        const nonce = randomBytes(12);
        const entryKey = deriveEntryKey(wrapKey, salt);
        try {
          entry.ciphertext = toBase64(
            gcm(entryKey, nonce, entryAad(entry)).encrypt(
              new TextEncoder().encode(secret),
            ),
          );
          entry.salt = toBase64(salt);
          entry.nonce = toBase64(nonce);
          entry.aad = 1;
          await this.write(file);
        } finally {
          wipe(entryKey);
          if (wrapKey !== this.cachedWrapKey) wipe(wrapKey);
        }
      });
    } catch {
      // 升级失败就继续用老格式：这条路径上用户要的是签名 / 查看助记词，
      // 不能因为顺手做的加固而让它失败
    }
  }

  private decrypt(
    entry: StoredEntry,
    wrapKey: Uint8Array,
    file: VaultFile,
  ): string {
    const entryKey = deriveEntryKey(wrapKey, fromBase64(entry.salt));
    try {
      // 老条目（无 `aad` 标记）当初就没带 AAD，得按原样解，否则升级即锁死用户
      const aad = aadFor(entry);
      const plaintext = gcm(entryKey, fromBase64(entry.nonce), aad).decrypt(
        fromBase64(entry.ciphertext),
      );
      const secret = new TextDecoder().decode(plaintext);
      wipe(plaintext);
      return secret;
    } catch {
      if (file.wkCheck === undefined)
        throw new WalletVaultKeyMissingError("mismatch");
      throw new WalletVaultError("stored key material could not be decrypted");
    } finally {
      wipe(entryKey);
    }
  }

  /**
   * 解出来的材料必须真的属于这条目登记的地址。密文、salt、nonce 都在普通存储里，
   * 能改 AsyncStorage 的人可以把两条目对调；没有这一步，签名器会用 B 的私钥替
   * A 声称的地址签名。
   */
  private assertOwner(
    entry: StoredEntry,
    secret: string,
  ): { address: string; privateKey: string } {
    // 按**密文里装的是什么**来判断，不是按这个账户当初从哪来。v2 条目装的是私钥，
    // 哪怕 kind 还记着 "mnemonic"（那是出身，不是内容）。
    const derived =
      secretKindOf(entry) === "mnemonic"
        ? deriveAccount(secret, pathIndex(entry.path))
        : accountFromPrivateKey(secret);
    if (!sameAddress(derived.address, entry.address))
      throw new WalletVaultError(
        "stored key material does not belong to this account",
      );
    return derived;
  }

  /** 弹一次系统认证，取消 / 失败即拒绝。`unavailable`（设备未录入）放行，见 N10。 */
  private async authenticateFresh(reason: string): Promise<void> {
    const outcome = await this.authenticatePort(reason);
    if (outcome === "cancelled" || outcome === "failed")
      throw new WalletAuthRequiredError(outcome);
  }

  /** 取包裹密钥用于**签名**：必须先过身份验证（或处于验证有效期内）。 */
  private async unlock(reason: string, file: VaultFile): Promise<Uint8Array> {
    if (this.cachedWrapKey && this.now() < this.cachedUntil)
      return this.cachedWrapKey;
    await this.authenticateFresh(reason);
    const wrapKey = await this.loadWrapKey(file);
    this.cachedWrapKey = wrapKey;
    this.cachedUntil = this.now() + this.unlockTtlMs;
    return wrapKey;
  }

  /**
   * 从密钥库取 WK 并与这份文件核对。
   * - 文件为空、密钥库也为空：这是全新 vault，生成并写入新 WK。
   * - 文件有条目、密钥库为空：WK 丢了，抛 `KeyMissing`，绝不铸新。
   * - 文件登记了 `wkCheck` 且与取到的 WK 不符：抛 `KeyMissing`。
   */
  private async loadWrapKey(file: VaultFile): Promise<Uint8Array> {
    const envelope = await this.readEnvelope();
    const existing =
      envelope === null
        ? await this.deps.secureStore.get(WRAP_KEY_STORE_KEY)
        : await this.readProtectedWrapKey(envelope);
    if (existing === null) {
      if (file.entries.length > 0)
        throw new WalletVaultKeyMissingError("missing");
      const created = randomBytes(32);
      await this.deps.secureStore.set(WRAP_KEY_STORE_KEY, toBase64(created));
      return created;
    }
    const wrapKey = fromBase64(existing);
    if (file.wkCheck !== undefined && file.wkCheck !== wkCheckOf(wrapKey)) {
      wipe(wrapKey);
      throw new WalletVaultKeyMissingError("mismatch");
    }
    return wrapKey;
  }

  // ---- 口令保护（安全评审 N6 / 方案 §3.5）----

  // ---- 助记词条目（方案 §3.3）----

  /**
   * 向用户要口令并派生口令密钥。只在真的需要助记词时调用——日常签名不走这里，
   * 那正是拆分的意义。
   */
  private async requirePassKey(
    envelope: WrapKeyEnvelope,
  ): Promise<Uint8Array> {
    const passphrase = await this.deps.requestPassphrase?.("unlock");
    if (!passphrase) throw new WalletPassphraseRequiredError();
    return derivePassKeyFor(envelope, passphrase);
  }

  /** 开了口令保护就必须拿到口令密钥；没开就返回 null（条目只由 WK 加密）。 */
  private async seedPassKey(): Promise<Uint8Array | null> {
    const envelope = await this.readEnvelope();
    return envelope === null ? null : this.requirePassKey(envelope);
  }

  private writeSeed(
    file: VaultFile,
    phrase: string,
    wrapKey: Uint8Array,
    passKey: Uint8Array | null,
  ): string {
    const id = `seed_${toBase64(randomBytes(12)).replace(/[^a-zA-Z0-9]/g, "")}`;
    const salt = randomBytes(16);
    const nonce = randomBytes(12);
    const meta = { id, ...(passKey === null ? {} : { protected: 1 as const }) };
    const key = deriveSeedKey(wrapKey, passKey, salt);
    try {
      const ciphertext = gcm(key, nonce, seedAad(meta)).encrypt(
        new TextEncoder().encode(phrase),
      );
      file.seeds = [
        ...(file.seeds ?? []),
        {
          ...meta,
          createdAt: new Date(this.now()).toISOString(),
          salt: toBase64(salt),
          nonce: toBase64(nonce),
          ciphertext: toBase64(ciphertext),
        },
      ];
      return id;
    } finally {
      wipe(key);
    }
  }

  /**
   * 解一条助记词。失败分类与 `decrypt` 一致：老文件（没有 wkCheck）解不开最可能是
   * 密钥库里的 WK 已经被静默换掉（修复前 N8 的存量状态），那要进恢复流程，
   * 不能报成笼统的"解不开"让用户卡在"查看助记词失败"。
   */
  private readSeed(
    seed: StoredSeed,
    wrapKey: Uint8Array,
    passKey: Uint8Array | null,
    file: VaultFile,
  ): string {
    if (seed.protected === 1 && passKey === null)
      throw new WalletPassphraseRequiredError();
    const key = deriveSeedKey(wrapKey, seed.protected === 1 ? passKey : null, fromBase64(seed.salt));
    try {
      const plaintext = gcm(key, fromBase64(seed.nonce), seedAad(seed)).decrypt(
        fromBase64(seed.ciphertext),
      );
      const phrase = new TextDecoder().decode(plaintext);
      wipe(plaintext);
      return phrase;
    } catch (error) {
      if (error instanceof WalletVaultError) throw error;
      if (file.wkCheck === undefined)
        throw new WalletVaultKeyMissingError("mismatch");
      throw new WalletVaultError(
        "stored key material could not be decrypted",
      );
    } finally {
      wipe(key);
    }
  }

  private async readEnvelope(): Promise<WrapKeyEnvelope | null> {
    const raw = await this.deps.storage.getItem(WRAP_KEY_ENVELOPE_STORAGE_KEY);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "ciphertext" in parsed
      )
        return parsed as WrapKeyEnvelope;
    } catch {
      // 落到下面：信封坏了就是金库坏了，不能当成"没开口令"静默退回旧路径——
      // 那条路径上的 WK 已经删掉了，退回去只会报一个误导性的 KeyMissing
    }
    throw new WalletVaultCorruptedError();
  }

  /** 这个金库有没有开口令保护。 */
  async isPassphraseProtected(): Promise<boolean> {
    return (await this.readEnvelope()) !== null;
  }

  /**
   * 取 WK：先走 A 路（系统验证），A 路不可用或已被系统作废就退到 B 路（口令），
   * 成功后立刻把 A 路重建起来。
   */
  private async readProtectedWrapKey(
    envelope: WrapKeyEnvelope,
  ): Promise<string> {
    const authenticated = this.deps.authenticatedStore;
    if (authenticated?.available()) {
      try {
        const value = await authenticated.get(WRAP_KEY_STORE_KEY);
        if (value !== null) return value;
      } catch {
        // 系统把这把密钥作废了（用户新录指纹、换了锁屏）。这**不是**错误路径，
        // 是设计里预期会发生的事——B 路就是为此存在的。
      }
    }
    const passphrase = await this.deps.requestPassphrase?.("unlock");
    if (!passphrase) throw new WalletPassphraseRequiredError();
    const deviceKey = await this.readDeviceKey();
    const wrapKey = await openWrapKey({ envelope, deviceKey, passphrase });
    const encoded = toBase64(wrapKey);
    wipe(wrapKey);
    wipe(deviceKey);
    // 重建 A 路：下一次就不用再输口令了。失败不影响本次解锁。
    if (authenticated?.available())
      await authenticated.set(WRAP_KEY_STORE_KEY, encoded).catch(() => {});
    return encoded;
  }

  private async readDeviceKey(): Promise<Uint8Array> {
    const stored = await this.deps.secureStore.get(
      ENVELOPE_DEVICE_KEY_STORE_KEY,
    );
    if (stored === null)
      throw new WalletVaultKeyMissingError("missing");
    return fromBase64(stored);
  }

  /**
   * 开启口令保护。
   *
   * 顺序是有讲究的：封好 → 写信封 → **立刻用同一个口令读回来核对** → 建 A 路 →
   * 最后才删掉那条谁都能读的旧 WK。核对这一步不能省：删旧 WK 是不可逆的，读不回来
   * 就等于把钱包锁死了。
   */
  async enablePassphrase(passphrase: string, reason: string): Promise<void> {
    assertPassphraseAcceptable(passphrase);
    await this.serialized(async () => {
      if (await this.readEnvelope())
        throw new WalletVaultError("passphrase protection is already enabled");
      const file = await this.read();
      await this.authenticateFresh(reason);
      const wrapKey = await this.loadWrapKey(file);
      try {
        const deviceKey = newDeviceKey();
        await this.deps.secureStore.set(
          ENVELOPE_DEVICE_KEY_STORE_KEY,
          toBase64(deviceKey),
        );
        const envelope = await sealWrapKey({ wrapKey, passphrase, deviceKey });
        await this.deps.storage.setItem(
          WRAP_KEY_ENVELOPE_STORAGE_KEY,
          JSON.stringify(envelope),
        );
        // 读回来核对：封装写错了要在删旧 WK **之前**发现
        const reopened = await openWrapKey({ envelope, deviceKey, passphrase });
        const matches = toBase64(reopened) === toBase64(wrapKey);
        wipe(reopened);
        wipe(deviceKey);
        if (!matches)
          throw new WalletVaultError(
            "the sealed wrap key did not read back; passphrase not enabled",
          );
        // 助记词条目改由 HKDF(WK ‖ 口令密钥) 加密：从这一刻起，拿到 WK 也拿不到
        // 助记词。**必须在删旧 WK 之前做完并落盘**，半开的状态会让 reveal 永远失败。
        const passKey = await derivePassKeyFor(envelope, passphrase);
        try {
          this.upgradeToV2(file, wrapKey);
          for (const seed of file.seeds ?? []) {
            if (seed.protected === 1) continue;
            const phrase = this.readSeed(seed, wrapKey, null, file);
            const salt = randomBytes(16);
            const nonce = randomBytes(12);
            const meta = { id: seed.id, protected: 1 as const };
            const key = deriveSeedKey(wrapKey, passKey, salt);
            try {
              seed.ciphertext = toBase64(
                gcm(key, nonce, seedAad(meta)).encrypt(
                  new TextEncoder().encode(phrase),
                ),
              );
              seed.salt = toBase64(salt);
              seed.nonce = toBase64(nonce);
              seed.protected = 1;
            } finally {
              wipe(key);
            }
          }
          await this.write(file);
        } finally {
          wipe(passKey);
        }
        if (this.deps.authenticatedStore?.available())
          await this.deps.authenticatedStore
            .set(WRAP_KEY_STORE_KEY, toBase64(wrapKey))
            .catch(() => {});
        // 最后一步：那条不需要任何系统验证就能读的 WK 必须消失，否则这一整套
        // 等于没做——N6 说的就是"JS 能直接读出包裹密钥"。
        await this.deps.secureStore.remove(WRAP_KEY_STORE_KEY);
      } finally {
        if (wrapKey !== this.cachedWrapKey) wipe(wrapKey);
      }
    });
  }

  /** 老文件没有 `wkCheck`：在一次 GCM 认证通过（证明 WK 正确）之后补写，幂等。 */
  private async backfillWkCheck(wrapKey: Uint8Array): Promise<void> {
    await this.serialized(async () => {
      const file = await this.read();
      if (file.wkCheck !== undefined) return;
      file.wkCheck = wkCheckOf(wrapKey);
      await this.write(file);
    });
  }

  private async archive(raw: string): Promise<string> {
    const key = `${VAULT_CORRUPT_BACKUP_PREFIX}${new Date(this.now()).toISOString()}`;
    await this.deps.storage.setItem(key, raw);
    return key;
  }

  private async read(): Promise<VaultFile> {
    const raw = await this.deps.storage.getItem(VAULT_STORAGE_KEY);
    if (raw === null) return { version: 1, entries: [] };
    const parsed = parseVaultFile(raw);
    if (parsed === null) throw new WalletVaultCorruptedError();
    return parsed;
  }

  private async write(file: VaultFile): Promise<void> {
    await this.deps.storage.setItem(VAULT_STORAGE_KEY, JSON.stringify(file));
  }

  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function parseVaultFile(raw: string): VaultFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const file = parsed as Partial<VaultFile>;
  if (
    (file.version !== 1 && file.version !== 2) ||
    !Array.isArray(file.entries)
  )
    return null;
  if (file.seeds !== undefined && !Array.isArray(file.seeds)) return null;
  if (file.wkCheck !== undefined && typeof file.wkCheck !== "string")
    return null;
  return file as VaultFile;
}

function isVaultFile(raw: string): boolean {
  return parseVaultFile(raw) !== null;
}

function wkCheckOf(wrapKey: Uint8Array): string {
  return toBase64(
    hkdf(sha256, wrapKey, WK_CHECK_SALT, new Uint8Array(0), WK_CHECK_LENGTH),
  );
}

function requireEntry(file: VaultFile, address: string): StoredEntry {
  const entry = file.entries.find((item) => sameAddress(item.address, address));
  if (!entry) throw new WalletVaultError("account is not in this vault");
  return entry;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function pathIndex(path: string | null): number {
  const tail = path?.split("/").pop();
  const index = Number(tail);
  return Number.isInteger(index) && index >= 0 ? index : 0;
}

/**
 * 条目加密密钥 = HKDF-SHA256(WK, salt, info)。WK 已是 32 字节高熵随机值，密钥分离用 HKDF 即足够。
 * 修订 1 曾保留 scrypt 口令分支，但没有任何调用方传口令（安全评审 §0.3 标为死代码），已移除；
 * 若将来引入钱包口令，须作为独立的 vault 版本迁移，而不是在这里加可选参数。
 */
function deriveEntryKey(wrapKey: Uint8Array, salt: Uint8Array): Uint8Array {
  return hkdf(sha256, wrapKey, salt, HKDF_INFO, 32);
}
