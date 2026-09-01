import { memoryStorage, type KeyValueStorage } from "../../gateways/types";
import { deriveAccount } from "../keygen/mnemonic";
import {
  KeystoreVault,
  WalletAuthRequiredError,
  WalletVaultError,
} from "./keystore-vault";
import { memorySecureStore, type AuthOutcome } from "./ports";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";

function setup(options?: { outcome?: AuthOutcome; unlockTtlMs?: number }) {
  const storage = memoryStorage();
  const secureStore = memorySecureStore();
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

    const raw = (await storage.getItem("foundation.wallet.vault.v1")) ?? "";
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
  });

  it("imports a mnemonic and reveals it again only after authentication", async () => {
    const { vault, authenticate } = setup();
    const entry = await vault.importMnemonic(PHRASE);
    expect(entry.address).toBe(ADDRESS);
    // 导入不弹验证：用户刚刚给出明确意图
    expect(authenticate).not.toHaveBeenCalled();

    await expect(vault.revealMnemonic(ADDRESS, "reveal")).resolves.toBe(PHRASE);
    expect(authenticate).toHaveBeenCalledWith("reveal");
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

  it("caches the unlock for its TTL and prompts again after it expires", async () => {
    const { vault, authenticate, advance } = setup({ unlockTtlMs: 60_000 });
    await vault.importMnemonic(PHRASE);
    await vault.revealMnemonic(ADDRESS, "reveal");
    await vault.revealMnemonic(ADDRESS, "reveal");
    expect(authenticate).toHaveBeenCalledTimes(1);

    advance(60_001);
    await vault.revealMnemonic(ADDRESS, "reveal");
    expect(authenticate).toHaveBeenCalledTimes(2);
  });

  it("drops the cached unlock when locked", async () => {
    const { vault, authenticate } = setup();
    await vault.importMnemonic(PHRASE);
    await vault.revealMnemonic(ADDRESS, "reveal");
    vault.lock();
    await vault.revealMnemonic(ADDRESS, "reveal");
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
    const { vault } = setup();
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
    // 无效导入不得留下任何条目
    expect(await vault.list()).toHaveLength(1);
  });

  it("cannot decrypt entries after the wrap key is replaced", async () => {
    const { vault, storage, secureStore } = setup();
    await vault.importMnemonic(PHRASE);
    await secureStore.remove("foundation.wallet.wrap-key.v1");
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

  it("tracks backup state and removes accounts", async () => {
    const { vault } = setup();
    await vault.importMnemonic(PHRASE);
    expect((await vault.list())[0]!.backedUpAt).toBeNull();
    await vault.markBackedUp(ADDRESS);
    expect((await vault.list())[0]!.backedUpAt).not.toBeNull();
    expect(await vault.has(ADDRESS.toLowerCase())).toBe(true);

    await vault.remove(ADDRESS);
    expect(await vault.list()).toHaveLength(0);
    expect(await vault.has(ADDRESS)).toBe(false);
  });

  it("wipes everything including the wrap key", async () => {
    const { vault, secureStore } = setup();
    await vault.importMnemonic(PHRASE);
    await vault.wipeAll();
    expect(await vault.list()).toHaveLength(0);
    expect(await secureStore.get("foundation.wallet.wrap-key.v1")).toBeNull();
  });

  it("survives a corrupted vault file instead of crashing the app", async () => {
    const storage: KeyValueStorage = memoryStorage();
    await storage.setItem("foundation.wallet.vault.v1", "{not json");
    const vault = new KeystoreVault({
      storage,
      secureStore: memorySecureStore(),
      authenticate: async () => "success",
    });
    expect(await vault.list()).toHaveLength(0);
  });
});
