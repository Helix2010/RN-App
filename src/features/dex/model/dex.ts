import type { ChainId, TokenRef, TxStatus } from "../../../core/gateways/types";
import type { LocalizedText } from "../../../core/i18n/localized-text";
import type { Money } from "../../../core/money/money";

export type TokenSummary = {
  token: TokenRef;
  /** 十进制字符串 USD 价格 */
  priceUsd: string;
  change24hPct: number;
  mcapUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  holders: number;
  /** 最近 24 个点的相对价格，用于迷你走势 */
  sparkline: number[];
  listedAt: string;
  isNew: boolean;
};

export type SecurityReport = {
  openSource: boolean;
  mintable: boolean;
  buyTaxBps: number;
  sellTaxBps: number;
  top10Pct: number;
  honeypot: boolean;
  passed: number;
  total: 4;
};

export type TokenDetail = TokenSummary & {
  high24hUsd: string;
  low24hUsd: string;
  security: SecurityReport;
  description?: LocalizedText;
};

export type TokenQuery = {
  chain?: ChainId;
  sort: "hot" | "gainers" | "new";
  search?: string;
  minLiquidityUsd?: number;
  cursor?: string | null;
  limit?: number;
};

export type CandleInterval = "15m" | "1h" | "4h" | "1d" | "1w";
export type Candle = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type DexTrade = {
  id: string;
  at: string;
  side: "buy" | "sell";
  amount: Money;
  usd: number;
  txHash: string;
};

export type QuoteRequest = {
  chain: ChainId;
  sellToken: TokenRef;
  buyToken: TokenRef;
  amountIn: Money;
  /** 万分比；undefined = 自动 */
  slippageBps?: number;
};

export type Quote = {
  id: string;
  chain: ChainId;
  sellToken: TokenRef;
  buyToken: TokenRef;
  amountIn: Money;
  amountOut: Money;
  minReceived: Money;
  amountInUsd: number;
  amountOutUsd: number;
  priceImpactPct: number;
  /** "1 BNB = 16,240,680 PEPE" 的原始数字 */
  rate: string;
  route: string[];
  routerName: string;
  networkFee: Money;
  networkFeeUsd: number;
  serviceFeeBps: number;
  slippageBps: number;
  slippageAuto: boolean;
  expiresAt: string;
  needsApproval: boolean;
};

export type SwapRecord = {
  id: string;
  chain: ChainId;
  sellToken: TokenRef;
  buyToken: TokenRef;
  amountIn: Money;
  /** 成功后为实际成交量 */
  amountOut?: Money;
  status: TxStatus;
  txHash?: string;
  reasonKey?: string;
  at: string;
  updatedAt: string;
};

export type Approval = {
  id: string;
  chain: ChainId;
  token: TokenRef;
  spender: { name: string; address: string };
  /** null = 无限额度 */
  allowance: Money | null;
  approvedAt: string;
  lastUsedAt?: string;
};
