import type { LocalizedText } from "../../../core/i18n/localized-text";
import type { Tx } from "../../../core/gateways/types";
import type { Money } from "../../../core/money/money";

export type EventKind = "binary" | "multi" | "sports";

/** 市场生命周期：交易截止与争议状态是两个独立维度，这里合成为展示状态。 */
export type MarketStatus =
  | "trading"
  | "awaiting_result"
  | "result_proposed"
  | "disputed"
  | "arbitrating"
  | "settled";

export type Outcome = "yes" | "no";

export type Tag = {
  id: string;
  slug: string;
  label: LocalizedText;
  order: number;
};

export type Market = {
  id: string;
  eventId: string;
  /** 多结果事件中该市场代表的选项名（如"法国"、"降 25 bp"）；二元市场为空 */
  outcomeLabel?: LocalizedText;
  question: LocalizedText;
  yesPriceCents: number;
  volumeUsd: number;
  endsAt: string;
  yesTokenId: string;
  noTokenId: string;
};

export type PredictEvent = {
  id: string;
  slug: string;
  title: LocalizedText;
  kind: EventKind;
  categoryTagId: string;
  tagIds: string[];
  markets: Market[];
  volumeUsd: number;
  holders: number;
  endsAt: string;
  featured: boolean;
  rules: LocalizedText;
  resolutionSource: LocalizedText;
  feeBps: number;
  disputeWindowSec: number;
  sports?: {
    home: LocalizedText;
    away: LocalizedText;
    homeCode: string;
    awayCode: string;
    startsAt: string;
  };
};

export type EventQuery = {
  tagId?: string;
  sort?: "volume" | "endingSoon" | "newest";
  featured?: boolean;
  search?: string;
  cursor?: string | null;
  limit?: number;
};

export type OrderBookLevel = { priceCents: number; shares: number };
export type OrderBook = {
  marketId: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  tickCents: number;
  updatedAt: string;
};
export type PricePoint = { t: string; priceCents: number };
export type PriceRange = "1h" | "6h" | "1d" | "1w" | "1m" | "all";

export type MarketEvent =
  | { type: "price_change"; marketId: string; yesPriceCents: number }
  | { type: "book"; book: OrderBook };

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit";
export type TimeInForce = "GTC" | "GTD";

export type PlaceOrderRequest = {
  marketId: string;
  outcome: Outcome;
  side: OrderSide;
  type: OrderType;
  /** 市价买入时的 USDC 金额 */
  amount?: Money;
  /** 限价单 / 卖出时的份数 */
  shares?: number;
  priceCents?: number;
  tif?: TimeInForce;
  expiresAt?: string;
};

export type OrderPreview = {
  estimatedShares: number;
  avgPriceCents: number;
  fee: Money;
  cost: Money;
  /** 若结果为该 outcome 可得（每份 1 USDC） */
  potentialPayout: Money;
  potentialReturnPct: number;
};

export type OrderResult = {
  orderId: string;
  status: "filled" | "open" | "partial" | "delayed";
  filledShares: number;
  avgPriceCents: number;
  fee: Money;
  cost: Money;
};

export type Order = {
  id: string;
  marketId: string;
  eventId: string;
  outcome: Outcome;
  side: OrderSide;
  type: OrderType;
  priceCents: number;
  shares: number;
  filledShares: number;
  tif: TimeInForce;
  expiresAt?: string;
  createdAt: string;
  status: "open" | "filled" | "cancelled" | "delayed" | "expired";
};

export type Position = {
  id: string;
  marketId: string;
  eventId: string;
  outcome: Outcome;
  shares: number;
  avgPriceCents: number;
  curPriceCents: number;
  value: Money;
  costBasis: Money;
  pnl: Money;
  pnlPct: number;
  status: MarketStatus;
  redeemable: boolean;
  /** 已结算时每份兑付（1 或 0 USDC） */
  settledPayoutCents?: number;
  /** 已领取（或已归零结算）的历史仓位 */
  closed?: boolean;
};

export type Adjudication = {
  marketId: string;
  status: MarketStatus;
  endsAt: string;
  proposedOutcome?: Outcome;
  proposedAt?: string;
  proposedEvidence?: LocalizedText;
  disputeDeadline?: string;
  disputeWindowSec: number;
  bond: Money;
  canDispute: boolean;
  disputedAt?: string;
  disputedBy?: string;
  settledOutcome?: Outcome;
  settledAt?: string;
};

export type ActivityType =
  | "TRADE"
  | "SPLIT"
  | "MERGE"
  | "REDEEM"
  | "DEPOSIT"
  | "DISPUTE_BOND"
  | "SETTLEMENT"
  | "FEE";

export type Activity = {
  id: string;
  type: ActivityType;
  marketId?: string;
  eventId?: string;
  title: LocalizedText;
  /** 有符号：正为入账 */
  amount: Money;
  detail?: LocalizedText;
  at: string;
};

export type PredictBalance = {
  available: Money;
  lockedInOrders: Money;
  positionsValue: Money;
  claimable: Money;
};

export type PnlPoint = { t: string; pnlUsd: number };

export type LeaderboardEntry = {
  rank: number;
  address: string;
  name?: string;
  pnlUsd: number;
  volumeUsd: number;
  winRatePct: number;
};

export type LeaderboardPeriod = "today" | "week" | "month" | "all";

export type PredictTx = Tx & {
  kind: "deposit" | "withdraw" | "redeem" | "split" | "merge" | "dispute";
};
