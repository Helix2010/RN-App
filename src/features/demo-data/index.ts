export type MockLocale = "zh-CN" | "en-US";

export type MockLocalizedText = Record<MockLocale, string>;

export type MockSwapDetail = {
  key: string;
  value: string;
  positive?: boolean;
};

export function mockText(value: MockLocalizedText, locale: string): string {
  return value[locale as MockLocale] ?? value["en-US"];
}

export const mockHomeData = {
  portfolio: {
    balance: "12,480.36",
    approx: { "zh-CN": "≈ ¥89,720.14", "en-US": "≈ $12,480.36" },
    today: {
      "zh-CN": "今日 +128.40 (+1.04%)",
      "en-US": "Today +128.40 (+1.04%)",
    },
    quoteCurrency: "USDT",
  },
  notice: {
    "zh-CN": "世界杯预测专场开启，交易手续费 8 折",
    "en-US": "World Cup prediction special is live · 20% off fees",
  },
  predictions: [
    {
      category: { "zh-CN": "加密", "en-US": "Crypto" },
      title: {
        "zh-CN": "BTC 本周收盘高于 120,000？",
        "en-US": "Will BTC close above 120,000 this week?",
      },
      closing: { "zh-CN": "1 天后截止", "en-US": "Closes in 1 day" },
      volume: { "zh-CN": "成交 $1.2M", "en-US": "$1.2M volume" },
      yesLabel: "Yes",
      noLabel: "No",
      yesPrice: "62¢",
      noPrice: "38¢",
    },
    {
      category: { "zh-CN": "财经", "en-US": "Macro" },
      title: {
        "zh-CN": "美联储 9 月 FOMC 降息幅度？",
        "en-US": "How much will the Fed cut rates in September?",
      },
      closing: { "zh-CN": "9 月 18 日截止", "en-US": "Closes Sep 18" },
      volume: { "zh-CN": "成交 $860K", "en-US": "$860K volume" },
      yesLabel: "Yes",
      noLabel: "No",
      yesPrice: "44¢",
      noPrice: "56¢",
    },
  ],
  dexTokens: [
    {
      symbol: "PEPE",
      chain: "BSC",
      price: "$0.00001234",
      change: 12.4,
      liquidity: "$4.2M",
    },
    {
      symbol: "WIF",
      chain: "Solana",
      price: "$1.842",
      change: -3.8,
      liquidity: "$2.8M",
    },
    {
      symbol: "AERO",
      chain: "Base",
      price: "$0.912",
      change: 5.1,
      liquidity: "$1.6M",
    },
  ],
} as const;

export const mockPredictMarkets = [
  {
    category: { "zh-CN": "专场 · 世界杯", "en-US": "Special · World Cup" },
    title: { "zh-CN": "2026 世界杯冠军", "en-US": "2026 World Cup winner" },
    meta: {
      "zh-CN": "32 个结果 · 成交 $3.4M",
      "en-US": "32 outcomes · $3.4M volume",
    },
    yesPrice: "62¢",
    noPrice: "38¢",
    yesLabel: "Yes",
    noLabel: "No",
  },
  {
    category: {
      "zh-CN": "加密 · 1 天后截止",
      "en-US": "Crypto · Closes in 1 day",
    },
    title: {
      "zh-CN": "BTC 8 月 31 日收盘价高于 $120,000？",
      "en-US": "Will BTC close above $120,000 on Aug 31?",
    },
    meta: {
      "zh-CN": "成交 $1.2M · 1,284 人持仓",
      "en-US": "$1.2M volume · 1,284 holders",
    },
    yesPrice: "62¢",
    noPrice: "38¢",
    yesLabel: "Yes",
    noLabel: "No",
  },
  {
    category: {
      "zh-CN": "财经 · 9 月 18 日截止",
      "en-US": "Macro · Closes Sep 18",
    },
    title: {
      "zh-CN": "美联储 9 月 FOMC 降息幅度？",
      "en-US": "How much will the Fed cut rates in September?",
    },
    meta: { "zh-CN": "成交 $860K", "en-US": "$860K volume" },
    yesPrice: "44¢",
    noPrice: "56¢",
    yesLabel: "Yes",
    noLabel: "No",
  },
] as const;

export const mockPredictPositions = [
  {
    status: "claimable" as const,
    value: "$2,340.12",
    question: mockPredictMarkets[1].title,
    side: "Yes",
    shares: "161.3",
    pnl: "+$61.30",
  },
  {
    status: "disputed" as const,
    value: "$780.00",
    question: mockPredictMarkets[0].title,
    side: "No",
    shares: "52.0",
    pnl: "-$18.40",
  },
  {
    status: "trading" as const,
    value: "$460.50",
    question: mockPredictMarkets[2].title,
    side: "Yes",
    shares: "20.4",
    pnl: "+$12.20",
  },
] as const;

export const mockDexTokens = [
  {
    symbol: "PEPE",
    chain: "BSC",
    price: "$0.00001234",
    change: 12.4,
    liquidity: "$4.2M",
  },
  {
    symbol: "WIF",
    chain: "Solana",
    price: "$1.842",
    change: -3.8,
    liquidity: "$2.8M",
  },
  {
    symbol: "AERO",
    chain: "Base",
    price: "$0.912",
    change: 5.1,
    liquidity: "$1.6M",
  },
  {
    symbol: "BONK",
    chain: "Solana",
    price: "$0.00002611",
    change: 9.7,
    liquidity: "$3.1M",
  },
] as const;

export const mockDexFilterChains = ["BSC", "Ethereum"] as const;

export const mockSwapQuote = {
  pay: {
    amount: "0.5",
    token: "BNB",
    balance: "0.842 BNB",
    value: "≈ $312.40",
  },
  receive: {
    amount: "8,120,340",
    token: "PEPE",
    balance: "0 PEPE",
    value: "≈ $311.06",
  },
  details: [
    { key: "rate", value: "1 BNB = 16,240,680 PEPE" },
    { key: "priceImpact", value: "0.12%", positive: true },
    { key: "minimumReceived", value: "8,079,738 PEPE" },
    { key: "slippage", value: "0.5% · Auto" },
    { key: "networkFee", value: "0.00012 BNB ≈ $0.08" },
    { key: "serviceFee", value: "0.10% · Included" },
  ] as MockSwapDetail[],
} as const;

export const mockAssetData = {
  total: "$27,028.51",
  today: "+$428.36 · +1.61%",
  available: "$18,806.27",
  networks: "3",
  accounts: {
    funding: {
      symbol: "wallet-outline",
      value: "8,120.00 USDT",
      subtitle: {
        "zh-CN": "充值、提现与划转中转",
        "en-US": "Deposit, withdrawal and transfer hub",
      },
    },
    predict: {
      symbol: "chart-timeline-variant",
      value: "3,580.62 USDT",
      subtitle: {
        "zh-CN": "可用 1,240.50 USDC · 持仓 $2,340.12",
        "en-US": "1,240.50 USDC available · $2,340.12 positions",
      },
    },
    dex: {
      symbol: "swap-horizontal",
      value: "780.24 USDT",
      subtitle: {
        "zh-CN": "0x3f4a…9a2c · 4 条链",
        "en-US": "0x3f4a…9a2c · 4 networks",
      },
    },
  },
  holdings: [
    {
      symbol: "ETH",
      network: "Ethereum",
      balance: "2.48 ETH",
      value: "$10,694.31",
      change: 3.2,
    },
    {
      symbol: "USDC",
      network: "Ethereum",
      balance: "8,420.00 USDC",
      value: "$8,420.00",
      change: 0.01,
    },
    {
      symbol: "BTC",
      network: "Bitcoin",
      balance: "0.072 BTC",
      value: "$7,914.20",
      change: -1.14,
    },
  ],
} as const;

export const mockPredictEvent = {
  status: "trading" as const,
  question: {
    "zh-CN": "BTC 本周收盘高于 $120,000？",
    "en-US": "Will BTC close above $120,000 this week?",
  },
  meta: {
    "zh-CN": "8 月 31 日 23:59 UTC 截止 · 成交 $1.2M",
    "en-US": "Closes Aug 31 at 23:59 UTC · $1.2M volume",
  },
  probability: "62%",
  yesPrice: "62¢",
  noPrice: "38¢",
  yesLabel: "Yes",
  noLabel: "No",
  yesDepth: "4,820",
  noDepth: "3,140",
  rules: {
    "zh-CN": "结果将依据公开、可验证的数据源进行结算。",
    "en-US": "The result is settled using public and verifiable data sources.",
  },
} as const;

export const mockDexToken = {
  symbol: "PEPE",
  pair: "PEPE / USDT",
  price: "$0.00001234",
  change: "+12.4%",
  chain: "BSC",
  address: "0x25d8…a4c1",
  marketCap: "$5.1B",
  liquidity: "$4.2M",
  volume: "$18.6M",
  securityScore: "4 / 4",
  securitySummary: {
    "zh-CN": "合约已开源，无增发权限，买卖税率正常。",
    "en-US": "Verified source, no mint authority and normal buy/sell tax.",
  },
} as const;

export const mockSwapHistory = [
  {
    pair: "BNB → PEPE",
    amount: "0.5 BNB → 8,118,902 PEPE",
    status: "confirming" as const,
    timestamp: { "zh-CN": "今天 12:04 · BSC", "en-US": "Today 12:04 · BSC" },
  },
  {
    pair: "USDT → WIF",
    amount: "200 USDT → 108.42 WIF",
    status: "success" as const,
    timestamp: {
      "zh-CN": "昨天 18:40 · Solana",
      "en-US": "Yesterday 18:40 · Solana",
    },
  },
  {
    pair: "ETH → AERO",
    amount: "0.12 ETH → —",
    status: "failed" as const,
    timestamp: {
      "zh-CN": "8 月 28 日 09:12 · Base",
      "en-US": "Aug 28 09:12 · Base",
    },
  },
] as const;

export const mockTransfer = {
  from: { "zh-CN": "资金账户", "en-US": "Funding account" },
  to: { "zh-CN": "预测账户", "en-US": "Prediction account" },
  amount: "500",
  currency: "USDC",
  available: "1,240.50",
} as const;

export const mockAccount = {
  title: { "zh-CN": "预测账户", "en-US": "Prediction account" },
  balance: "3,580.62 USDT",
  subtitle: {
    "zh-CN": "可用 1,240.50 USDC · 持仓 $2,340.12",
    "en-US": "1,240.50 USDC available · $2,340.12 positions",
  },
  assets: [
    { label: "USDC", labelKey: undefined, value: "1,560.50" },
    { label: "USDT", labelKey: undefined, value: "1,240.50" },
    { label: undefined, labelKey: "assets.locked", value: "779.62" },
  ],
} as const;

export const mockProfile = {
  displayName: "AnyFun User",
  walletAddress: "0x71C7…F8A2",
  network: { "zh-CN": "Ethereum 主网", "en-US": "Ethereum Mainnet" },
} as const;

export const mockSettings = {
  quoteCurrency: "USDT",
  dexSlippage: { "zh-CN": "0.5% · 自动", "en-US": "0.5% · Auto" },
  cacheSize: "28.4 MB",
  colorScheme: { "zh-CN": "绿涨红跌", "en-US": "Green up / red down" },
  predictOrderType: { "zh-CN": "市价", "en-US": "Market" },
} as const;

export const mockSecurity = {
  level: "high" as const,
  protections: "3 / 3",
  email: "ke***@chainup.com",
  devices: "3",
  addresses: "3",
} as const;

export const mockNotificationSettings = [
  { key: "orderFilled", enabled: true },
  { key: "predictSettled", enabled: true },
  { key: "predictClaimable", enabled: true },
  { key: "swapResult", enabled: true },
  { key: "priceAlert", enabled: true },
  { key: "promo", enabled: false },
  { key: "security", enabled: true },
] as const;
