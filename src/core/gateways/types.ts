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

/** `op-sepolia` 是测试链：币无价值，界面上必须和主网区分开。 */
export type ChainId = "bsc" | "eth" | "base" | "op-sepolia";

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
  "op-sepolia": {
    id: "op-sepolia",
    name: "OP Sepolia",
    shortName: "OP Sep",
    nativeSymbol: "ETH",
    nativeDecimals: 18,
    color: "#FF0420",
    explorerUrl: "https://sepolia-optimism.etherscan.io",
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
  /** 链上精度（协议事实）：最小单位与人类可读金额之间的换算只认它 */
  decimals: number;
  /**
   * 展示精度：列表、余额、输入框保留几位小数，向下截断。
   * 只影响"显示成什么样"，任何金额换算都不许读它——拿它去算最小单位，
   * USDT 转 1.005 就会静默变成 1.00。永远 ≤ decimals。
   */
  displayDecimals: number;
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
