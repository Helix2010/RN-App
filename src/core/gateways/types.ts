export type Page<T> = { items: T[]; nextCursor: string | null };

export type Unsubscribe = () => void;

/** 链上交易的统一状态机（WEB3_UI_STANDARD §4）。 */
export type TxStatus =
  | "preparing"
  | "awaiting_signature"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "failed";

export type Tx = {
  id: string;
  status: TxStatus;
  hash?: string;
  /** 失败原因的 i18n key */
  reasonKey?: string;
  updatedAt: string;
};

export type ChainId = "bsc" | "eth" | "base";

export type Chain = {
  id: ChainId;
  name: string;
  shortName: string;
  nativeSymbol: string;
  nativeDecimals: number;
  color: string;
  explorerUrl: string;
};

export const CHAINS: Record<ChainId, Chain> = {
  bsc: {
    id: "bsc",
    name: "BNB Smart Chain",
    shortName: "BSC",
    nativeSymbol: "BNB",
    nativeDecimals: 18,
    color: "#F0B90B",
    explorerUrl: "https://bscscan.com",
  },
  eth: {
    id: "eth",
    name: "Ethereum",
    shortName: "ETH",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    color: "#627EEA",
    explorerUrl: "https://etherscan.io",
  },
  base: {
    id: "base",
    name: "Base",
    shortName: "Base",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    color: "#0052FF",
    explorerUrl: "https://basescan.org",
  },
};

export type TokenRef = {
  chain: ChainId;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  /** Logo 加载失败时的确定性底色 */
  logoColor: string;
  verified: boolean;
};

/** 简单的键值存储抽象，Mock 状态持久化用；测试注入内存实现。 */
export type KeyValueStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export function memoryStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: async (key) => map.get(key) ?? null,
    setItem: async (key, value) => {
      map.set(key, value);
    },
    removeItem: async (key) => {
      map.delete(key);
    },
  };
}

let idCounter = 0;
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}
