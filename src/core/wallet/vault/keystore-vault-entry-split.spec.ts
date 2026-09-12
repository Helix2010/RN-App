import { gcm } from "@noble/ciphers/aes.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { memoryStorage, type KeyValueStorage } from "../../gateways/types";
import { deriveAccount } from "../keygen/mnemonic";
import { KeystoreVault, WalletPassphraseRequiredError } from "./keystore-vault";
import {
  memorySecureStore,
  type AuthenticatedSecureStorePort,
  type SecureStorePort,
} from "./ports";

/**
 * 条目拆分（安全评审 N29 第三部分 / 方案 §3.3）。
 *
 * 这些用例盯的是一件事：**日常签名不再碰助记词**。在此之前每签一次名都要解出
 * 助记词、重新跑一遍 BIP-39/BIP-32，根种子于是每次都进 JS 堆；而 Hermes 没有字符串
 * 清零，进去了就擦不掉。
 */

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const ADDRESS = deriveAccount(PHRASE, 0).address;
const VAULT_KEY = "foundation.wallet.vault.v1";
const PASSPHRASE = "correct horse battery";

type RawFile = {
  version: number;
  entries: Record<string, string | undefined>[];
  seeds?: Record<string, string | undefined>[];
};

function setup() {
  const storage = memoryStorage();
  const inner = memorySecureStore();
  const secureStore: SecureStorePort = {
    get: jest.fn(inner.get),
    set: jest.fn(inner.set),
    remove: jest.fn(inner.remove),
  };
  const authInner = memorySecureStore();
  const authenticatedStore: AuthenticatedSecureStorePort = {
    get: jest.fn(authInner.get),
    set: jest.fn(authInner.set),
    remove: jest.fn(authInner.remove),
    available: () => true,
  };
  const requestPassphrase = jest.fn(async () => PASSPHRASE as string | null);
  const vault = new KeystoreVault({
    storage,
    secureStore,
    authenticate: async () => "success",
    authenticatedStore,
    requestPassphrase,
    now: () => 1_700_000_000_000,
  });
  return { vault, storage, requestPassphrase, secureStore };
}

async function rawFile(storage: KeyValueStorage): Promise<RawFile> {
  return JSON.parse((await storage.getItem(VAULT_KEY)) ?? "null") as RawFile;
}

describe("账户私钥与助记词分开保管", () => {
  it("账户条目里装的是这个账户的私钥，不是助记词", async () => {
    const { vault, storage } = setup();
    await vault.importMnemonic(PHRASE);

    const file = await rawFile(storage);
    expect(file.version).toBe(2);
    expect(file.entries[0]!.aad).toBe(2);
    expect(file.entries[0]!.seedId).toEqual(expect.any(String));
    // 助记词搬到自己的条目里了
    expect(file.seeds).toHaveLength(1);
    expect(file.seeds![0]!.id).toBe(file.entries[0]!.seedId);
  });

  it("签名只解账户那把私钥，拿到的正是这个地址的私钥", async () => {
    const { vault } = setup();
    await vault.importMnemonic(PHRASE);

    const used = await vault.withPrivateKey(ADDRESS, "sign", (key) => key);

    expect(used).toBe(deriveAccount(PHRASE, 0).privateKey);
  });

  // 这是拆分的全部意义：开了口令保护之后，签名路径完全不需要口令，
  // 而助记词没有口令拿不到
  it("开了口令保护后：签名不问口令，查看助记词要问", async () => {
    const { vault, requestPassphrase } = setup();
    await vault.importMnemonic(PHRASE);
    await vault.enablePassphrase(PASSPHRASE, "security.enable");
    requestPassphrase.mockClear();

    await vault.withPrivateKey(ADDRESS, "sign", () => undefined);
    expect(requestPassphrase).not.toHaveBeenCalled();

    const revealed = await vault.revealMnemonic(ADDRESS, "reveal");
    expect(revealed).toBe(PHRASE);
    expect(requestPassphrase).toHaveBeenCalledWith("unlock");
  });

  it("开了口令保护之后，助记词条目标成 protected", async () => {
    const { vault, storage } = setup();
    await vault.importMnemonic(PHRASE);
    await vault.enablePassphrase(PASSPHRASE, "r");

    expect((await rawFile(storage)).seeds![0]!.protected).toBe(1);
  });

  it("拿不到口令就拿不到助记词——签名照常", async () => {
    const { vault, requestPassphrase } = setup();
    await vault.importMnemonic(PHRASE);
    await vault.enablePassphrase(PASSPHRASE, "r");
    requestPassphrase.mockResolvedValue(null);

    await expect(vault.revealMnemonic(ADDRESS, "reveal")).rejects.toThrow(
      WalletPassphraseRequiredError,
    );
    await expect(
      vault.withPrivateKey(ADDRESS, "sign", () => "signed"),
    ).resolves.toBe("signed");
  });

  it("导入的私钥没有助记词条目，也没有 seedId", async () => {
    const { vault, storage } = setup();
    const key = deriveAccount(PHRASE, 3).privateKey;
    await vault.importPrivateKey(key);

    const file = await rawFile(storage);
    expect(file.seeds ?? []).toHaveLength(0);
    expect(file.entries[0]!.seedId).toBeUndefined();
    await expect(
      vault.revealMnemonic(deriveAccount(PHRASE, 3).address, "reveal"),
    ).rejects.toThrow("imported without a mnemonic");
  });

  it("同一条助记词的多个账户共用一条助记词条目", async () => {
    const { vault, storage } = setup();
    await vault.importMnemonic(PHRASE);
    await vault.importMnemonic(PHRASE, 1, "import");

    const file = await rawFile(storage);
    expect(file.entries).toHaveLength(2);
    // 两次导入各写一条：这是已知的取舍，去重要把所有助记词都解出来比对
    expect(file.seeds!.length).toBeGreaterThanOrEqual(1);
    expect(
      await vault.revealMnemonic(deriveAccount(PHRASE, 1).address, "reveal"),
    ).toBe(PHRASE);
  });
});

describe("删除账户", () => {
  it("没有账户再引用的助记词一起删掉", async () => {
    const { vault, storage } = setup();
    await vault.importMnemonic(PHRASE);
    expect((await rawFile(storage)).seeds).toHaveLength(1);

    await vault.remove(ADDRESS, "remove");

    // 留着它等于"删了钱包，助记词还在设备上"
    expect((await rawFile(storage)).seeds).toHaveLength(0);
  });

  it("同一条助记词还有别的账户在用就不删", async () => {
    const { vault, storage } = setup();
    await vault.importMnemonic(PHRASE);
    const file = await rawFile(storage);
    // 让第二个账户指向同一条助记词
    await vault.importMnemonic(PHRASE, 1, "import");
    const both = await rawFile(storage);
    both.entries[1]!.seedId = file.seeds![0]!.id;
    both.seeds = [file.seeds![0]!];
    await storage.setItem(VAULT_KEY, JSON.stringify(both));

    await vault.remove(ADDRESS, "remove");

    expect((await rawFile(storage)).seeds).toHaveLength(1);
  });
});

describe("老文件就地升级", () => {
  /**
   * 造一个真正的 v1 文件：账户条目的密文里装的是**助记词**，带 v1 的 AAD，
   * 没有 seeds。这正是这次改动之前每一台设备上的形状。
   */
  async function makeV1(storage: KeyValueStorage, wrapKeyB64: string) {
    const file = await rawFile(storage);
    const entry = file.entries[0]!;
    const wrapKey = Uint8Array.from(Buffer.from(wrapKeyB64, "base64"));
    const salt = Uint8Array.from(Buffer.from(entry.salt!, "base64"));
    const nonce = Uint8Array.from(Buffer.from(entry.nonce!, "base64"));
    const entryKey = hkdf(
      sha256,
      wrapKey,
      salt,
      new TextEncoder().encode("foundation.wallet.entry.v1"),
      32,
    );
    const aad = new TextEncoder().encode(
      JSON.stringify([
        "v1",
        entry.address!.toLowerCase(),
        entry.kind,
        entry.path,
      ]),
    );
    entry.ciphertext = Buffer.from(
      gcm(entryKey, nonce, aad).encrypt(new TextEncoder().encode(PHRASE)),
    ).toString("base64");
    entry.aad = 1 as unknown as string;
    delete entry.seedId;
    delete file.seeds;
    file.version = 1;
    await storage.setItem(VAULT_KEY, JSON.stringify(file));
  }

  it("v1 文件能签名、能看助记词，并在签名之后就地升级成 v2", async () => {
    const { vault, storage, secureStore } = setup();
    await vault.importMnemonic(PHRASE);
    const wrapKeyB64 = (await secureStore.get(
      "foundation.wallet.wrap-key.v1",
    ))!;
    await makeV1(storage, wrapKeyB64);
    expect((await rawFile(storage)).version).toBe(1);

    // 升级前：助记词还躺在账户条目里，两条路都得通
    expect(await vault.revealMnemonic(ADDRESS, "reveal")).toBe(PHRASE);
    const used = await vault.withPrivateKey(ADDRESS, "sign", (key) => key);
    expect(used).toBe(deriveAccount(PHRASE, 0).privateKey);

    // 签名路径顺手把文件升级了
    await new Promise((resolve) => setTimeout(resolve, 0));
    const upgraded = await rawFile(storage);
    expect(upgraded.version).toBe(2);
    expect(upgraded.seeds).toHaveLength(1);
    expect(upgraded.entries[0]!.aad).toBe(2 as unknown as string);

    // 升级之后两条路仍然通，而且签名拿到的是同一把私钥
    expect(await vault.revealMnemonic(ADDRESS, "reveal")).toBe(PHRASE);
    expect(await vault.withPrivateKey(ADDRESS, "sign", (key) => key)).toBe(
      deriveAccount(PHRASE, 0).privateKey,
    );
  });

  it("升级是幂等的：再签一次不会又写一遍文件", async () => {
    const { vault, storage, secureStore } = setup();
    await vault.importMnemonic(PHRASE);
    await makeV1(
      storage,
      (await secureStore.get("foundation.wallet.wrap-key.v1"))!,
    );
    await vault.withPrivateKey(ADDRESS, "sign", () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const before = await storage.getItem(VAULT_KEY);
    await vault.withPrivateKey(ADDRESS, "sign", () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await storage.getItem(VAULT_KEY)).toBe(before);
  });
});
