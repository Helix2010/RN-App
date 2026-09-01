import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { scrypt } from "@noble/hashes/scrypt.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "ethers";
import type { KeyValueStorage } from "../../gateways/types";
import {
  accountFromPrivateKey,
  deriveAccount,
  generateMnemonic,
  normalizeMnemonic,
  normalizePrivateKey,
} from "../keygen/mnemonic";
import type { AuthenticatePort, SecureStorePort } from "./ports";

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
 */

const WRAP_KEY_STORE_KEY = "foundation.wallet.wrap-key.v1";
const VAULT_STORAGE_KEY = "foundation.wallet.vault.v1";
const HKDF_INFO = new TextEncoder().encode("foundation.wallet.entry.v1");
/** 成功验证后 WK 在内存里的有效期，对应 Keystore 的认证有效期，避免每次签名都弹窗。 */
const DEFAULT_UNLOCK_TTL_MS = 5 * 60 * 1_000;
const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, dkLen: 32 } as const;

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
};

type VaultFile = { version: 1; entries: StoredEntry[] };

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

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function wipe(bytes: Uint8Array): void {
  bytes.fill(0);
}

type KeystoreVaultDeps = {
  storage: KeyValueStorage;
  secureStore: SecureStorePort;
  authenticate: AuthenticatePort;
  unlockTtlMs?: number;
  now?: () => number;
};

export class KeystoreVault {
  private cachedWrapKey: Uint8Array | null = null;
  private cachedUntil = 0;
  private readonly unlockTtlMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: KeystoreVaultDeps) {
    this.unlockTtlMs = deps.unlockTtlMs ?? DEFAULT_UNLOCK_TTL_MS;
    this.now = deps.now ?? Date.now;
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
   * 生成新钱包（注册路径）。助记词**只在此处返回一次**给备份流程展示，
   * 之后必须经 `revealMnemonic` 并通过身份验证才能再次取得。
   */
  async createWallet(): Promise<{ entry: VaultEntry; mnemonic: string }> {
    const mnemonic = generateMnemonic(128);
    const entry = await this.putSecret(mnemonic, "mnemonic", 0);
    return { entry, mnemonic };
  }

  async importMnemonic(phrase: string, index = 0): Promise<VaultEntry> {
    const normalized = normalizeMnemonic(phrase);
    // 先派生一次，无效助记词在这里就抛，不会写入任何东西
    deriveAccount(normalized, index);
    return this.putSecret(normalized, "mnemonic", index);
  }

  async importPrivateKey(key: string): Promise<VaultEntry> {
    const normalized = normalizePrivateKey(key);
    accountFromPrivateKey(normalized);
    return this.putSecret(normalized, "private-key", null);
  }

  /** 导出助记词（备份 / 恢复）。必须通过身份验证。 */
  async revealMnemonic(address: string, reason: string): Promise<string> {
    const entry = await this.requireEntry(address);
    if (entry.kind !== "mnemonic")
      throw new WalletVaultError("account was imported without a mnemonic");
    return this.decrypt(entry, reason);
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
    const entry = await this.requireEntry(address);
    const secret = await this.decrypt(entry, reason);
    const privateKey =
      entry.kind === "mnemonic"
        ? deriveAccount(secret, pathIndex(entry.path)).privateKey
        : secret;
    return consume(privateKey);
  }

  async markBackedUp(address: string): Promise<void> {
    const file = await this.read();
    const entry = file.entries.find((item) =>
      sameAddress(item.address, address),
    );
    if (!entry) throw new WalletVaultError("account is not in this vault");
    entry.backedUpAt = new Date(this.now()).toISOString();
    await this.write(file);
  }

  async remove(address: string): Promise<void> {
    const file = await this.read();
    file.entries = file.entries.filter(
      (entry) => !sameAddress(entry.address, address),
    );
    await this.write(file);
  }

  /** 清空整个 Vault 与包裹密钥（重置 / 退出并删除钱包）。 */
  async wipeAll(): Promise<void> {
    this.lock();
    await this.deps.storage.removeItem(VAULT_STORAGE_KEY);
    await this.deps.secureStore.remove(WRAP_KEY_STORE_KEY);
  }

  private async requireEntry(address: string): Promise<StoredEntry> {
    const file = await this.read();
    const entry = file.entries.find((item) =>
      sameAddress(item.address, address),
    );
    if (!entry) throw new WalletVaultError("account is not in this vault");
    return entry;
  }

  private async putSecret(
    secret: string,
    kind: VaultEntryKind,
    index: number | null,
  ): Promise<VaultEntry> {
    const account =
      kind === "mnemonic"
        ? deriveAccount(secret, index ?? 0)
        : accountFromPrivateKey(secret);
    const file = await this.read();
    if (file.entries.some((item) => sameAddress(item.address, account.address)))
      throw new WalletVaultError("account already exists in this vault");
    const salt = randomBytes(16);
    const nonce = randomBytes(12);
    const wrapKey = await this.wrapKey();
    const entryKey = deriveEntryKey(wrapKey, salt);
    try {
      const ciphertext = gcm(entryKey, nonce).encrypt(
        new TextEncoder().encode(secret),
      );
      const entry: StoredEntry = {
        address: account.address,
        kind,
        path: account.path,
        createdAt: new Date(this.now()).toISOString(),
        backedUpAt: null,
        salt: toBase64(salt),
        nonce: toBase64(nonce),
        ciphertext: toBase64(ciphertext),
      };
      file.entries.push(entry);
      await this.write(file);
      const { salt: _s, nonce: _n, ciphertext: _c, ...visible } = entry;
      void _s;
      void _n;
      void _c;
      return visible;
    } finally {
      wipe(entryKey);
    }
  }

  private async decrypt(entry: StoredEntry, reason: string): Promise<string> {
    const wrapKey = await this.unlock(reason);
    const entryKey = deriveEntryKey(wrapKey, fromBase64(entry.salt));
    try {
      const plaintext = gcm(entryKey, fromBase64(entry.nonce)).decrypt(
        fromBase64(entry.ciphertext),
      );
      const secret = new TextDecoder().decode(plaintext);
      wipe(plaintext);
      return secret;
    } catch (error) {
      if (error instanceof WalletVaultError) throw error;
      throw new WalletVaultError("stored key material could not be decrypted");
    } finally {
      wipe(entryKey);
    }
  }

  /** 取包裹密钥用于**解密**：必须先过身份验证（或处于验证有效期内）。 */
  private async unlock(reason: string): Promise<Uint8Array> {
    if (this.cachedWrapKey && this.now() < this.cachedUntil)
      return this.cachedWrapKey;
    const outcome = await this.deps.authenticate(reason);
    // 设备未录入生物识别 / 锁屏时放行，否则用户会被永久锁在钱包外面
    if (outcome === "cancelled" || outcome === "failed")
      throw new WalletAuthRequiredError(outcome);
    const wrapKey = await this.wrapKey();
    this.cachedWrapKey = wrapKey;
    this.cachedUntil = this.now() + this.unlockTtlMs;
    return wrapKey;
  }

  /** 取包裹密钥用于**加密**（新建 / 导入）：不弹验证，用户刚刚给出明确意图。 */
  private async wrapKey(): Promise<Uint8Array> {
    const existing = await this.deps.secureStore.get(WRAP_KEY_STORE_KEY);
    if (existing) return fromBase64(existing);
    const created = randomBytes(32);
    await this.deps.secureStore.set(WRAP_KEY_STORE_KEY, toBase64(created));
    return created;
  }

  private async read(): Promise<VaultFile> {
    const raw = await this.deps.storage.getItem(VAULT_STORAGE_KEY);
    if (!raw) return { version: 1, entries: [] };
    try {
      const parsed = JSON.parse(raw) as VaultFile;
      if (parsed?.version !== 1 || !Array.isArray(parsed.entries))
        return { version: 1, entries: [] };
      return parsed;
    } catch {
      return { version: 1, entries: [] };
    }
  }

  private async write(file: VaultFile): Promise<void> {
    await this.deps.storage.setItem(VAULT_STORAGE_KEY, JSON.stringify(file));
  }
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
 * 条目加密密钥 = HKDF-SHA256(WK ‖ 可选口令材料, salt)。
 * WK 已是 32 字节高熵随机值，密钥分离用 HKDF 即足够；scrypt 只在用户设置了
 * 钱包口令（低熵输入）时参与，用于抗离线暴力破解。
 */
function deriveEntryKey(
  wrapKey: Uint8Array,
  salt: Uint8Array,
  passphrase?: string,
): Uint8Array {
  const stretched =
    passphrase !== undefined && passphrase !== ""
      ? scrypt(new TextEncoder().encode(passphrase), salt, SCRYPT_PARAMS)
      : new Uint8Array(0);
  const ikm = new Uint8Array(wrapKey.length + stretched.length);
  ikm.set(wrapKey, 0);
  ikm.set(stretched, wrapKey.length);
  try {
    return hkdf(sha256, ikm, salt, HKDF_INFO, 32);
  } finally {
    wipe(ikm);
    wipe(stretched);
  }
}
