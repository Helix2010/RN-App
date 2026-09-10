import { memoryStorage, type KeyValueStorage } from "../../gateways/types";
import { deriveAccount } from "../keygen/mnemonic";
import {
  KeystoreVault,
  VAULT_CORRUPT_BACKUP_PREFIX,
  WalletAuthRequiredError,
  WalletVaultCorruptedError,
  WalletVaultError,
  WalletVaultKeyMissingError,
} from "./keystore-vault";
import {
  memorySecureStore,
  type AuthOutcome,
  type SecureStorePort,
} from "./ports";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const OTHER_PHRASE =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";
const OTHER_ADDRESS = deriveAccount(OTHER_PHRASE, 0).address;
const VAULT_KEY = "foundation.wallet.vault.v1";
const WK_KEY = "foundation.wallet.wrap-key.v1";

function setup(options?: { outcome?: AuthOutcome; unlockTtlMs?: number }) {
  const storage = memoryStorage();
  const inner = memorySecureStore();
  const secureStore: SecureStorePort = {
    get: jest.fn(inner.get),
    set: jest.fn(inner.set),
    remove: jest.fn(inner.remove),
  };
  let outcome: AuthOutcome = options?.outcome ?? "success";
  const authenticate = jest.fn(async () => outcome);
  let clock = 1_700_000_000_000;
  const vault = new KeystoreVault({
    storage,
    secureStore,
    authenticate,
    unlockTtlMs: options?.unlockTtlMs ?? 5 * 60 * 1_000,
    now: () => clock,
  });
  return {
    vault,
    storage,
    secureStore,
    authenticate,
    setOutcome: (next: AuthOutcome) => {
      outcome = next;
    },
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

type RawEntry = Record<string, string | null>;
type RawFile = { version: number; entries: RawEntry[]; wkCheck?: string };

async function rawFile(storage: KeyValueStorage): Promise<RawFile> {
  return JSON.parse((await storage.getItem(VAULT_KEY)) ?? "null") as RawFile;
}

async function backupKeys(storage: KeyValueStorage): Promise<string[]> {
  // memoryStorage 没有 keys()：按已知时间戳格式探测
  const keys: string[] = [];
  for (const candidate of [
    `${VAULT_CORRUPT_BACKUP_PREFIX}2023-11-14T22:13:20.000Z`,
  ]) {
    if ((await storage.getItem(candidate)) !== null) keys.push(candidate);
  }
  return keys;
}

describe("KeystoreVault", () => {
  it("creates a wallet, returns the phrase once, and keeps only ciphertext at rest", async () => {
    const { vault, storage } = setup();
    const { entry, mnemonic } = await vault.createWallet();
    expect(mnemonic.split(" ")).toHaveLength(12);
    expect(entry).toMatchObject({
      kind: "mnemonic",
      path: "m/44'/60'/0'/0/0",
      backedUpAt: null,
    });
    expect(entry.address).toBe(deriveAccount(mnemonic, 0).address);

    const raw = (await storage.getItem(VAULT_KEY)) ?? "";
    expect(raw).not.toContain(mnemonic);
    expect(raw).not.toContain(mnemonic.split(" ").slice(0, 3).join(" "));
    // 密文既不是明文，也不是明文的某种编码
    const stored = JSON.parse(raw).entries[0];
    expect(globalThis.atob(stored.ciphertext)).not.toContain(mnemonic);
    expect(stored.ciphertext).not.toContain(globalThis.btoa(mnemonic));
    // 元数据可见，密钥材料不可见
    expect(raw).toContain(entry.address);
    expect(await vault.list()).toHaveLength(1);
    expect(Object.keys((await vault.list())[0]!)).toEqual(
      expect.not.arrayContaining(["ciphertext", "salt", "nonce"]),
    );
    // 新文件登记 WK 校验值
    expect(typeof JSON.parse(raw).wkCheck).toBe("string");
  });

  it("imports a mnemonic and reveals it again only after authentication", async () => {
    const { vault, authenticate } = setup();
    const entry = await vault.importMnemonic(PHRASE);
    expect(entry.address).toBe(ADDRESS);
    // 首次导入到空 vault 不弹验证：用户刚刚给出明确意图
    expect(authenticate).not.toHaveBeenCalled();

    await expect(vault.revealMnemonic(ADDRESS, "reveal")).resolves.toBe(PHRASE);
    expect(authenticate).toHaveBeenCalledWith("reveal");
  });

  it("creates the first wallet without a prompt but authenticates before adding another", async () => {
    const { vault, authenticate, setOutcome } = setup();
    await vault.createWallet();
    expect(authenticate).not.toHaveBeenCalled();
    await expect(vault.createWallet()).rejects.toThrow(
      "requires authentication",
    );
    setOutcome("cancelled");
    await expect(
      vault.createWallet("wallet.create.authReason"),
    ).rejects.toBeInstanceOf(WalletAuthRequiredError);
    expect(await vault.list()).toHaveLength(1);
    setOutcome("success");
    await vault.createWallet("wallet.create.authReason");
    expect(authenticate).toHaveBeenLastCalledWith("wallet.create.authReason");
    expect(await vault.list()).toHaveLength(2);
  });

  it("requires authentication to add an account to a non-empty vault", async () => {
    const { vault, authenticate, setOutcome } = setup();
    await vault.importMnemonic(PHRASE);
    await expect(vault.importMnemonic(OTHER_PHRASE)).rejects.toThrow(
      "requires authentication",
    );
    setOutcome("cancelled");
    await expect(
      vault.importMnemonic(OTHER_PHRASE, 0, "import"),
    ).rejects.toBeInstanceOf(WalletAuthRequiredError);
    expect(await vault.list()).toHaveLength(1);
    setOutcome("success");
    await vault.importMnemonic(OTHER_PHRASE, 0, "import");
    expect(authenticate).toHaveBeenLastCalledWith("import");
    expect(await vault.list()).toHaveLength(2);
  });

  it("refuses to decrypt when authentication is cancelled or fails", async () => {
    const { vault, setOutcome } = setup();
    await vault.importMnemonic(PHRASE);
    setOutcome("cancelled");
    await expect(
      vault.revealMnemonic(ADDRESS, "reveal"),
    ).rejects.toBeInstanceOf(WalletAuthRequiredError);
    setOutcome("failed");
    await expect(
      vault.revealMnemonic(ADDRESS, "reveal"),
    ).rejects.toBeInstanceOf(WalletAuthRequiredError);
  });

  it("still opens on a device with no biometrics or screen lock", async () => {
    // 否则未录入生物识别的用户会被永久锁在钱包外面（app-lock 已踩过这个坑）
    const { vault, setOutcome } = setup();
    await vault.importMnemonic(PHRASE);
    setOutcome("unavailable");
    await expect(vault.revealMnemonic(ADDRESS, "reveal")).resolves.toBe(PHRASE);
  });

  it("caches the signing unlock for its TTL and prompts again after it expires", async () => {
    const { vault, authenticate, advance } = setup({ unlockTtlMs: 60_000 });
    await vault.importMnemonic(PHRASE);
    await vault.withPrivateKey(ADDRESS, "sign", () => undefined);
    await vault.withPrivateKey(ADDRESS, "sign", () => undefined);
    expect(authenticate).toHaveBeenCalledTimes(1);

    advance(60_001);
    await vault.withPrivateKey(ADDRESS, "sign", () => undefined);
    expect(authenticate).toHaveBeenCalledTimes(2);
  });

  it("reveal always re-authenticates even inside the signing TTL", async () => {
    const { vault, authenticate } = setup();
    await vault.importMnemonic(PHRASE);
    await vault.withPrivateKey(ADDRESS, "sign", () => undefined);
    expect(authenticate).toHaveBeenCalledTimes(1);
    // 刚签完名，看助记词仍要再验一次
    await vault.revealMnemonic(ADDRESS, "reveal");
    expect(authenticate).toHaveBeenCalledTimes(2);
    // 反过来，reveal 也不会替签名预热缓存
    vault.lock();
    await vault.revealMnemonic(ADDRESS, "reveal");
    await vault.withPrivateKey(ADDRESS, "sign", () => undefined);
    expect(authenticate).toHaveBeenCalledTimes(4);
  });

  it("drops the cached unlock when locked", async () => {
    const { vault, authenticate } = setup();
    await vault.importMnemonic(PHRASE);
    await vault.withPrivateKey(ADDRESS, "sign", () => undefined);
    vault.lock();
    await vault.withPrivateKey(ADDRESS, "sign", () => undefined);
    expect(authenticate).toHaveBeenCalledTimes(2);
  });

  it("hands the derived private key to a callback without returning it", async () => {
    const { vault } = setup();
    await vault.importMnemonic(PHRASE);
    const expected = deriveAccount(PHRASE, 0).privateKey;
    await expect(
      vault.withPrivateKey(ADDRESS, "sign", (key) => key === expected),
    ).resolves.toBe(true);
  });

  it("supports private-key imports and refuses to invent a mnemonic for them", async () => {
    const { vault } = setup();
    const key = deriveAccount(PHRASE, 3).privateKey;
    const entry = await vault.importPrivateKey(key);
    expect(entry).toMatchObject({ kind: "private-key", path: null });
    await expect(
      vault.revealMnemonic(entry.address, "reveal"),
    ).rejects.toBeInstanceOf(WalletVaultError);
    await expect(
      vault.withPrivateKey(entry.address, "sign", (value) => value),
    ).resolves.toBe(key);
  });

  it("rejects duplicates, unknown accounts and invalid material", async () => {
    const { vault, authenticate } = setup();
    await vault.importMnemonic(PHRASE);
    await expect(vault.importMnemonic(PHRASE)).rejects.toThrow(
      "already exists",
    );
    await expect(vault.importMnemonic("not a mnemonic")).rejects.toThrow(
      "invalid mnemonic",
    );
    await expect(vault.importPrivateKey("0xnope")).rejects.toThrow(
      "invalid private key",
    );
    await expect(
      vault.revealMnemonic("0x0000000000000000000000000000000000000001", "r"),
    ).rejects.toThrow("not in this vault");
    // 无效导入不得留下任何条目，也不该弹过认证
    expect(await vault.list()).toHaveLength(1);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("refuses to mint a new wrap key while the vault still has entries", async () => {
    const { vault, storage, secureStore } = setup();
    await vault.importMnemonic(PHRASE);
    await secureStore.remove(WK_KEY);
    (secureStore.set as jest.Mock).mockClear();
    const reopened = new KeystoreVault({
      storage,
      secureStore,
      authenticate: async () => "success",
    });
    // 条目还列得出来（界面要能告诉用户"有钱包但解不开"）
    expect(await reopened.list()).toHaveLength(1);
    await expect(reopened.verifyWrapKey()).rejects.toBeInstanceOf(
      WalletVaultKeyMissingError,
    );
    await expect(
      reopened.revealMnemonic(ADDRESS, "reveal"),
    ).rejects.toBeInstanceOf(WalletVaultKeyMissingError);
    await expect(
      reopened.withPrivateKey(ADDRESS, "sign", () => undefined),
    ).rejects.toBeInstanceOf(WalletVaultKeyMissingError);
    // 往解不开的 vault 里导入新账户也不行：那会让同一文件里混两把 WK
    await expect(
      reopened.importMnemonic(OTHER_PHRASE, 0, "import"),
    ).rejects.toBeInstanceOf(WalletVaultKeyMissingError);
    expect(secureStore.set).not.toHaveBeenCalled();
    expect(await storage.getItem(WK_KEY)).toBeNull();
    expect((await rawFile(storage)).entries).toHaveLength(1);
  });

  it("detects a replaced wrap key before touching any ciphertext", async () => {
    const { vault, storage, secureStore } = setup();
    await vault.importMnemonic(PHRASE);
    // 密钥库里换成另一把 WK（例如另一个 vault 遗留的）
    await secureStore.set(WK_KEY, globalThis.btoa("x".repeat(32)));
    const reopened = new KeystoreVault({
      storage,
      secureStore,
      authenticate: async () => "success",
    });
    await expect(reopened.verifyWrapKey()).rejects.toMatchObject({
      name: "WalletVaultKeyMissingError",
      kind: "mismatch",
    });
    await expect(
      reopened.revealMnemonic(ADDRESS, "reveal"),
    ).rejects.toBeInstanceOf(WalletVaultKeyMissingError);
  });

  it("backfills wkCheck on legacy files exactly once", async () => {
    const { vault, storage } = setup();
    await vault.importMnemonic(PHRASE);
    // 模拟修订前写出的文件：没有 wkCheck
    const legacy = await rawFile(storage);
    delete legacy.wkCheck;
    await storage.setItem(VAULT_KEY, JSON.stringify(legacy));
    const setItem = jest.spyOn(storage, "setItem");

    await vault.revealMnemonic(ADDRESS, "reveal");
    expect(typeof (await rawFile(storage)).wkCheck).toBe("string");
    expect(setItem).toHaveBeenCalledTimes(1);

    await vault.revealMnemonic(ADDRESS, "reveal");
    await vault.withPrivateKey(ADDRESS, "sign", () => undefined);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("does not stamp wkCheck onto a legacy file just because a new account was added", async () => {
    const { vault, storage } = setup();
    await vault.importMnemonic(PHRASE);
    const legacy = await rawFile(storage);
    delete legacy.wkCheck;
    await storage.setItem(VAULT_KEY, JSON.stringify(legacy));

    // 往老文件里加账户：还没证明密钥库里的 WK 解得开旧条目，不能打标记
    await vault.importMnemonic(OTHER_PHRASE, 0, "import");
    expect((await rawFile(storage)).wkCheck).toBeUndefined();
    expect((await rawFile(storage)).entries).toHaveLength(2);

    // 一次成功解密之后才补写，且只写一次
    const setItem = jest.spyOn(storage, "setItem");
    await vault.withPrivateKey(ADDRESS, "sign", () => undefined);
    expect(typeof (await rawFile(storage)).wkCheck).toBe("string");
    await vault.withPrivateKey(OTHER_ADDRESS, "sign", () => undefined);
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("serialises concurrent writes so both imports persist under one wrap key and the second one authenticates", async () => {
    const { vault, secureStore, authenticate } = setup();
    await Promise.all([
      vault.importMnemonic(PHRASE, 0, "import"),
      vault.importMnemonic(OTHER_PHRASE, 0, "import"),
    ]);
    const entries = await vault.list();
    expect(entries.map((entry) => entry.address).sort()).toEqual(
      [ADDRESS, OTHER_ADDRESS].sort(),
    );
    expect(secureStore.set).toHaveBeenCalledTimes(1);
    // 第一条进空 vault 免认证；第二条排在它后面，看到的已是非空 vault，必须认证
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(authenticate).toHaveBeenCalledWith("import");
    // 两条都能用同一把 WK 解开
    await expect(vault.revealMnemonic(ADDRESS, "r")).resolves.toBe(PHRASE);
    await expect(vault.revealMnemonic(OTHER_ADDRESS, "r")).resolves.toBe(
      OTHER_PHRASE,
    );
  });

  it("concurrent adds without a reason cannot both slip past the non-empty check", async () => {
    const { vault, authenticate } = setup();
    const results = await Promise.allSettled([
      vault.importMnemonic(PHRASE),
      vault.importMnemonic(OTHER_PHRASE),
    ]);
    expect(results[0]!.status).toBe("fulfilled");
    expect(results[1]!.status).toBe("rejected");
    expect((results[1] as PromiseRejectedResult).reason.message).toContain(
      "requires authentication",
    );
    expect(await vault.list()).toHaveLength(1);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("rejects key material that does not belong to the entry's address", async () => {
    const { vault, storage } = setup();
    await vault.importMnemonic(PHRASE);
    await vault.importMnemonic(OTHER_PHRASE, 0, "import");
    const file = await rawFile(storage);
    const [first, second] = file.entries as [RawEntry, RawEntry];
    // 能写 AsyncStorage 的人把两条目的密文对调
    for (const field of ["ciphertext", "salt", "nonce"] as const) {
      [first[field], second[field]] = [second[field]!, first[field]!];
    }
    await storage.setItem(VAULT_KEY, JSON.stringify(file));

    await expect(
      vault.withPrivateKey(ADDRESS, "sign", () => undefined),
    ).rejects.toThrow("does not belong to this account");
    await expect(vault.revealMnemonic(ADDRESS, "reveal")).rejects.toThrow(
      "does not belong to this account",
    );
  });

  it("cannot decrypt entries after the wrap key is replaced", async () => {
    const { vault, storage, secureStore } = setup();
    await vault.importMnemonic(PHRASE);
    await secureStore.remove(WK_KEY);
    const reopened = new KeystoreVault({
      storage,
      secureStore,
      authenticate: async () => "success",
    });
    // 硬件密钥库里的 WK 丢失 => 密文不可解，而不是静默返回错误的密钥
    await expect(
      reopened.revealMnemonic(ADDRESS, "reveal"),
    ).rejects.toBeInstanceOf(WalletVaultError);
  });

  it("treats an undecryptable legacy file as a wrap-key mismatch so recovery can start", async () => {
    // 修复前 N8 的存量状态：老文件（无 wkCheck）+ 密钥库里已被静默换成另一把 WK
    const { vault, storage, secureStore } = setup();
    await vault.importMnemonic(PHRASE);
    const legacy = await rawFile(storage);
    delete legacy.wkCheck;
    await storage.setItem(VAULT_KEY, JSON.stringify(legacy));
    await secureStore.set(WK_KEY, globalThis.btoa("y".repeat(32)));
    const authenticate = jest.fn(async () => "success" as const);
    const reopened = new KeystoreVault({ storage, secureStore, authenticate });

    // 只看校验值看不出来（老文件没有），但解密失败必须归类为 KeyMissing 而不是笼统的解不开
    await expect(reopened.verifyWrapKey()).resolves.toBeUndefined();
    await expect(
      reopened.withPrivateKey(ADDRESS, "sign", () => undefined),
    ).rejects.toMatchObject({
      name: "WalletVaultKeyMissingError",
      kind: "mismatch",
    });
    await expect(
      reopened.revealMnemonic(ADDRESS, "reveal"),
    ).rejects.toMatchObject({
      name: "WalletVaultKeyMissingError",
      kind: "mismatch",
    });
    // 恢复流程用的探测：认证一次、真的解一条，解不开就是 mismatch，文件不被打标记
    await expect(reopened.verifyLegacyWrapKey("recover")).rejects.toMatchObject(
      { name: "WalletVaultKeyMissingError", kind: "mismatch" },
    );
    expect(authenticate).toHaveBeenCalledWith("recover");
    expect((await rawFile(storage)).wkCheck).toBeUndefined();
  });

  it("verifyLegacyWrapKey authenticates once, proves the key and backfills wkCheck on a healthy legacy file", async () => {
    const { vault, storage, authenticate } = setup();
    await vault.importMnemonic(PHRASE);
    const legacy = await rawFile(storage);
    delete legacy.wkCheck;
    await storage.setItem(VAULT_KEY, JSON.stringify(legacy));

    await expect(vault.verifyLegacyWrapKey("recover")).resolves.toBeUndefined();
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(typeof (await rawFile(storage)).wkCheck).toBe("string");
    // 已有 wkCheck 的文件不再探测、不再弹认证
    await expect(vault.verifyLegacyWrapKey("recover")).resolves.toBeUndefined();
    expect(authenticate).toHaveBeenCalledTimes(1);
    // 有 wkCheck 且核对通过的文件里，密文本身坏了仍是笼统的"解不开"，不是 KeyMissing
    const file = await rawFile(storage);
    file.entries[0]!.ciphertext = globalThis.btoa("garbage-ciphertext-bytes!!");
    await storage.setItem(VAULT_KEY, JSON.stringify(file));
    await expect(vault.revealMnemonic(ADDRESS, "reveal")).rejects.toThrow(
      "could not be decrypted",
    );
  });

  it("tracks backup state and removes accounts after authentication", async () => {
    const { vault, authenticate, setOutcome } = setup();
    await vault.importMnemonic(PHRASE);
    expect((await vault.list())[0]!.backedUpAt).toBeNull();
    await vault.markBackedUp(ADDRESS);
    expect((await vault.list())[0]!.backedUpAt).not.toBeNull();
    expect(await vault.has(ADDRESS.toLowerCase())).toBe(true);
    expect(authenticate).not.toHaveBeenCalled();

    setOutcome("cancelled");
    await expect(vault.remove(ADDRESS, "remove")).rejects.toBeInstanceOf(
      WalletAuthRequiredError,
    );
    expect(await vault.list()).toHaveLength(1);
    setOutcome("success");
    await vault.remove(ADDRESS, "remove");
    expect(authenticate).toHaveBeenLastCalledWith("remove");
    expect(await vault.list()).toHaveLength(0);
    expect(await vault.has(ADDRESS)).toBe(false);
  });

  it("wipes everything including the wrap key after authentication", async () => {
    const { vault, secureStore, setOutcome } = setup();
    await vault.importMnemonic(PHRASE);
    setOutcome("failed");
    await expect(vault.wipeAll("wipe")).rejects.toBeInstanceOf(
      WalletAuthRequiredError,
    );
    expect(await vault.list()).toHaveLength(1);
    setOutcome("success");
    await vault.wipeAll("wipe");
    expect(await vault.list()).toHaveLength(0);
    expect(await secureStore.get(WK_KEY)).toBeNull();
  });

  it("refuses to overwrite a corrupted vault file", async () => {
    const { vault, storage } = setup();
    await storage.setItem(VAULT_KEY, "{not json");

    await expect(vault.list()).rejects.toBeInstanceOf(
      WalletVaultCorruptedError,
    );
    await expect(vault.has(ADDRESS)).rejects.toBeInstanceOf(
      WalletVaultCorruptedError,
    );
    await expect(vault.createWallet()).rejects.toBeInstanceOf(
      WalletVaultCorruptedError,
    );
    await expect(vault.importMnemonic(PHRASE)).rejects.toBeInstanceOf(
      WalletVaultCorruptedError,
    );
    await expect(vault.markBackedUp(ADDRESS)).rejects.toBeInstanceOf(
      WalletVaultCorruptedError,
    );
    // 原文一个字节都没动
    expect(await storage.getItem(VAULT_KEY)).toBe("{not json");
    expect(await backupKeys(storage)).toEqual([]);

    // 用户明确要清空时，先归档原文再删
    await vault.wipeAll("wipe");
    expect(await storage.getItem(VAULT_KEY)).toBeNull();
    const backups = await backupKeys(storage);
    expect(backups).toHaveLength(1);
    expect(await storage.getItem(backups[0]!)).toBe("{not json");
  });

  it("treats an unknown file version as corrupted, not as empty", async () => {
    const { vault, storage } = setup();
    await storage.setItem(
      VAULT_KEY,
      JSON.stringify({ version: 2, entries: [{ address: ADDRESS }] }),
    );
    await expect(vault.list()).rejects.toBeInstanceOf(
      WalletVaultCorruptedError,
    );
    await expect(vault.importMnemonic(PHRASE)).rejects.toBeInstanceOf(
      WalletVaultCorruptedError,
    );
    expect((await rawFile(storage)).version).toBe(2);
  });

  it("archives and resets a broken vault only after authentication, keeping the wrap key", async () => {
    const { vault, storage, secureStore, authenticate, setOutcome } = setup();
    await vault.importMnemonic(PHRASE);
    const wrapKey = await secureStore.get(WK_KEY);
    await storage.setItem(VAULT_KEY, "{not json");

    setOutcome("cancelled");
    await expect(vault.archiveAndReset("recover")).rejects.toBeInstanceOf(
      WalletAuthRequiredError,
    );
    expect(await storage.getItem(VAULT_KEY)).toBe("{not json");

    setOutcome("success");
    const key = await vault.archiveAndReset("recover");
    expect(authenticate).toHaveBeenLastCalledWith("recover");
    expect(key?.startsWith(VAULT_CORRUPT_BACKUP_PREFIX)).toBe(true);
    expect(await storage.getItem(key!)).toBe("{not json");
    expect(await storage.getItem(VAULT_KEY)).toBeNull();
    expect(await secureStore.get(WK_KEY)).toBe(wrapKey);
    // 空位上再 reset 是 no-op
    expect(await vault.archiveAndReset("recover")).toBeNull();

    // 之后可以正常导入恢复，且沿用原 WK
    await vault.importMnemonic(OTHER_PHRASE);
    await expect(vault.revealMnemonic(OTHER_ADDRESS, "r")).resolves.toBe(
      OTHER_PHRASE,
    );
    expect(await secureStore.get(WK_KEY)).toBe(wrapKey);
  });

  it("verifyWrapKey passes on healthy and empty vaults", async () => {
    const { vault } = setup();
    await expect(vault.verifyWrapKey()).resolves.toBeUndefined();
    await vault.importMnemonic(PHRASE);
    await expect(vault.verifyWrapKey()).resolves.toBeUndefined();
  });
});
