import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "ethers";
import type { KeyValueStorage } from "../../../core/gateways/types";
import type { SecureStorePort } from "../../../core/wallet/vault/ports";

/**
 * WalletConnect SDK 的加密存储（安全评审 N14）。
 *
 * SDK 默认把会话状态直接写 AsyncStorage，里面包含每条会话的对称密钥
 * （`symKey`）。AsyncStorage 是普通文件，root 过的机器、备份导出、以及任何
 * 能读应用私有目录的手段都能拿到它——拿到 symKey 就能冒充本 App 与钱包通信，
 * 发起用户没点过的签名请求。
 *
 * 这里在 SDK 和 AsyncStorage 之间插一层：值用 AES-GCM 加密，密钥放系统密钥库
 * （Android Keystore / iOS Keychain），普通存储里只留密文。键名不加密——它们是
 * SDK 的内部命名（`wc@2:core:0.3//keychain` 这类），不含机密，而且 `getKeys`
 * 要按前缀枚举。
 */

const STORAGE_PREFIX = "foundation.wc.enc.v1.";
const INDEX_KEY = `${STORAGE_PREFIX}__index`;
const KEY_STORE_KEY = "foundation.wallet.wc-storage-key.v1";

/** SDK 侧要求的存储接口（`@walletconnect/keyvaluestorage` 的形状）。 */
export type WcKeyValueStorage = {
  getKeys: () => Promise<string[]>;
  getEntries: <T = unknown>() => Promise<[string, T][]>;
  getItem: <T = unknown>(key: string) => Promise<T | undefined>;
  setItem: <T = unknown>(key: string, value: T) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export type EncryptedWcStorageDeps = {
  secure: SecureStorePort;
  storage: KeyValueStorage;
  /** 注入随机源，测试里可确定化 */
  randomBytes?: (size: number) => Uint8Array;
};

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

export function createEncryptedWcStorage(
  deps: EncryptedWcStorageDeps,
): WcKeyValueStorage & {
  /** 删掉 SDK 早先写下的明文条目，别把旧 symKey 留在盘上。 */
  purgeLegacy: (keys: string[]) => Promise<void>;
} {
  const random = deps.randomBytes ?? randomBytes;
  let keyPromise: Promise<Uint8Array> | null = null;

  /** 存储密钥：密钥库里没有就现造一把。丢了等于所有会话失效，用户重连即可。 */
  const storageKey = (): Promise<Uint8Array> => {
    keyPromise ??= (async () => {
      const existing = await deps.secure.get(KEY_STORE_KEY);
      if (existing !== null) return fromBase64(existing);
      const created = random(32);
      await deps.secure.set(KEY_STORE_KEY, toBase64(created));
      return created;
    })();
    return keyPromise;
  };

  const readIndex = async (): Promise<string[]> => {
    const raw = await deps.storage.getItem(INDEX_KEY);
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      // 索引坏了就当没有会话：SDK 会重新配对，比带着半份索引乱跑安全
      return [];
    }
  };

  const writeIndex = (keys: string[]): Promise<void> =>
    deps.storage.setItem(INDEX_KEY, JSON.stringify(keys));

  const decode = async <T>(raw: string): Promise<T | undefined> => {
    const bytes = fromBase64(raw);
    if (bytes.length <= 12) return undefined;
    try {
      const plaintext = gcm(await storageKey(), bytes.slice(0, 12)).decrypt(
        bytes.slice(12),
      );
      return JSON.parse(new TextDecoder().decode(plaintext)) as T;
    } catch {
      // 解不开（换过密钥库、条目被改）就当没有这条：不能把坏数据喂给 SDK
      return undefined;
    }
  };

  return {
    getKeys: readIndex,

    getEntries: async <T>() => {
      const entries: [string, T][] = [];
      for (const key of await readIndex()) {
        const raw = await deps.storage.getItem(STORAGE_PREFIX + key);
        if (raw === null) continue;
        const value = await decode<T>(raw);
        if (value !== undefined) entries.push([key, value]);
      }
      return entries;
    },

    getItem: async <T>(key: string) => {
      const raw = await deps.storage.getItem(STORAGE_PREFIX + key);
      if (raw === null) return undefined;
      return decode<T>(raw);
    },

    setItem: async (key, value) => {
      const nonce = random(12);
      const ciphertext = gcm(await storageKey(), nonce).encrypt(
        new TextEncoder().encode(JSON.stringify(value)),
      );
      const packed = new Uint8Array(nonce.length + ciphertext.length);
      packed.set(nonce);
      packed.set(ciphertext, nonce.length);
      await deps.storage.setItem(STORAGE_PREFIX + key, toBase64(packed));
      const keys = await readIndex();
      if (!keys.includes(key)) await writeIndex([...keys, key]);
    },

    removeItem: async (key) => {
      await deps.storage.removeItem(STORAGE_PREFIX + key);
      const keys = await readIndex();
      if (keys.includes(key)) await writeIndex(keys.filter((k) => k !== key));
    },

    purgeLegacy: async (keys) => {
      for (const key of keys) await deps.storage.removeItem(key);
    },
  };
}
