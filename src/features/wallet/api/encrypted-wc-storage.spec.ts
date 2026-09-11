import {
  memoryStorage,
  type KeyValueStorage,
} from "../../../core/gateways/types";
import { memorySecureStore } from "../../../core/wallet/vault/ports";
import { createEncryptedWcStorage } from "./encrypted-wc-storage";

function setup() {
  const storage = memoryStorage();
  const secure = memorySecureStore();
  return {
    storage,
    secure,
    wc: createEncryptedWcStorage({ storage, secure }),
  };
}

/** 把普通存储里的所有值拼起来，用来断言明文没落盘。 */
async function dump(storage: KeyValueStorage, keys: string[]): Promise<string> {
  const parts: string[] = [];
  for (const key of keys) parts.push((await storage.getItem(key)) ?? "");
  return parts.join("|");
}

const SESSION = {
  topic: "topic-1",
  symKey: "9f4c2d1e8b7a6f5049382716aabbccdd00112233445566778899aabbccddeeff",
};

describe("encrypted WalletConnect storage", () => {
  it("round-trips a value the SDK stored", async () => {
    const { wc } = setup();
    await wc.setItem("wc@2:client//session", SESSION);
    await expect(wc.getItem("wc@2:client//session")).resolves.toEqual(SESSION);
  });

  it("never writes the session key in the clear", async () => {
    const { wc, storage } = setup();
    await wc.setItem("wc@2:core:0.3//keychain", SESSION);
    const written = await dump(storage, [
      "foundation.wc.enc.v1.wc@2:core:0.3//keychain",
      "foundation.wc.enc.v1.__index",
    ]);
    // symKey 落到普通存储里，等于任何能读应用目录的人都能冒充本 App（安全评审 N14）
    expect(written).not.toContain(SESSION.symKey);
    expect(written).not.toContain("topic-1");
  });

  it("keeps the encryption key in the system keystore, not in plain storage", async () => {
    const { wc, secure, storage } = setup();
    await wc.setItem("k", SESSION);
    const stored = await secure.get("foundation.wallet.wc-storage-key.v1");
    expect(stored).toEqual(expect.any(String));
    expect(await dump(storage, ["foundation.wc.enc.v1.k"])).not.toContain(
      stored as string,
    );
  });

  it("lists and enumerates exactly the keys the SDK set", async () => {
    const { wc } = setup();
    await wc.setItem("a", { n: 1 });
    await wc.setItem("b", { n: 2 });
    await expect(wc.getKeys()).resolves.toEqual(["a", "b"]);
    await expect(wc.getEntries()).resolves.toEqual([
      ["a", { n: 1 }],
      ["b", { n: 2 }],
    ]);
  });

  it("does not grow the index when the same key is written twice", async () => {
    const { wc } = setup();
    await wc.setItem("a", { n: 1 });
    await wc.setItem("a", { n: 2 });
    await expect(wc.getKeys()).resolves.toEqual(["a"]);
    await expect(wc.getItem("a")).resolves.toEqual({ n: 2 });
  });

  it("keeps every key when the SDK writes several at once", async () => {
    const { wc } = setup();
    const keys = ["a", "b", "c", "d", "e", "f", "g", "h"];
    // SDK 建会话时并发写多个键：索引不串行就会互相覆盖，会话看起来凭空消失
    await Promise.all(keys.map((key) => wc.setItem(key, { key })));
    await expect(wc.getKeys()).resolves.toEqual(expect.arrayContaining(keys));
    expect((await wc.getKeys()).length).toBe(keys.length);
  });

  it("keeps the index consistent when writes and deletes interleave", async () => {
    const { wc } = setup();
    await Promise.all([
      wc.setItem("a", { n: 1 }),
      wc.setItem("b", { n: 2 }),
      wc.removeItem("a"),
      wc.setItem("c", { n: 3 }),
    ]);
    const keys = await wc.getKeys();
    expect(keys).toContain("b");
    expect(keys).toContain("c");
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("forgets a removed key completely", async () => {
    const { wc, storage } = setup();
    await wc.setItem("a", SESSION);
    await wc.removeItem("a");
    await expect(wc.getKeys()).resolves.toEqual([]);
    await expect(wc.getItem("a")).resolves.toBeUndefined();
    expect(await storage.getItem("foundation.wc.enc.v1.a")).toBeNull();
  });

  it("reports a missing key as undefined rather than throwing", async () => {
    const { wc } = setup();
    await expect(wc.getItem("nope")).resolves.toBeUndefined();
  });

  it("treats an entry it cannot decrypt as absent", async () => {
    const { wc, storage } = setup();
    await wc.setItem("a", SESSION);
    await storage.setItem("foundation.wc.enc.v1.a", "AAAAAAAAAAAAAAAAAAAA");
    // 换过密钥库或条目被改：宁可让 SDK 重新配对，也不能把坏数据当会话用
    await expect(wc.getItem("a")).resolves.toBeUndefined();
    await expect(wc.getEntries()).resolves.toEqual([]);
  });

  it("survives a corrupted index instead of failing every read", async () => {
    const { wc, storage } = setup();
    await wc.setItem("a", SESSION);
    await storage.setItem("foundation.wc.enc.v1.__index", "{not json");
    await expect(wc.getKeys()).resolves.toEqual([]);
  });

  it("deletes the plaintext entries the SDK wrote before the upgrade", async () => {
    const { wc, storage } = setup();
    await storage.setItem("wc@2:core:0.3//keychain", JSON.stringify(SESSION));
    await wc.purgeLegacy(["wc@2:core:0.3//keychain"]);
    expect(await storage.getItem("wc@2:core:0.3//keychain")).toBeNull();
  });
});
