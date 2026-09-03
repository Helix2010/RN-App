import type { LocalizedText } from "../../../core/i18n/localized-text";
import type { Tx } from "../../../core/gateways/types";
import type { Money } from "../../../core/money/money";

type EventKind = "binary" | "multi" | "sports";

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
  /** YES 展示价（分）。平台暂无报价（无买卖盘也无成交）时为 null，界面显示占位而不编数 */
  yesPriceCents: number | null;
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
  /** 展示用分类标签 = 首个标签的多语言名称（categoryTagId 只用于筛选） */
  category: LocalizedText;
  tagIds: string[];
  markets: Market[];
  volumeUsd: number;
  /** 持有人数；平台不提供时为 null（界面不显示，不编数） */
  holders: number | null;
  endsAt: string;
  featured: boolean;
  rules: LocalizedText;
  resolutionSource: LocalizedText;
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

type OrderBookLevel = { priceCents: number; shares: number };
export type OrderBook = {
  marketId: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  tickCents: number;
  /** clob 对该代币的最小下单份数（`/book` 的 min_order_size；不足会被 400 拒绝） */
  minOrderShares: number;
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
  /** 买入为扣完手续费到手的份数（平台买入手续费从份额里扣） */
  estimatedShares: number;
  /** 沿簿吃不到任何一档时为 null */
  avgPriceCents: number | null;
  fee: Money;
  cost: Money;
  /** 买入：若结果为该 outcome 可得（每份 1 USDW）；卖出：扣费后的回款 */
  potentialPayout: Money;
  /** 只对买入有意义，卖出 / 无成交为 null */
  potentialReturnPct: number | null;
  /**
   * 市价买入：按当前对手价与 tick 取整后仍满足平台 1 USDC 下限的最小金额
   * （份数向下对齐 0.01 后 price × shares 常常略小于输入金额）；其它单类为 null
   */
  minAmount: Money | null;
};

export type OrderResult = {
  orderId: string;
  status: "filled" | "open" | "partial" | "delayed";
  filledShares: number;
  /** 成交均价；平台应答里没有可用的成交额时为 null（实测 prax1s 的 taking / making 都是份数） */
  avgPriceCents: number | null;
  fee: Money | null;
  cost: Money | null;
};

export type Order = {
  id: string;
  marketId: string;
  eventId: string;
  /** 市场问题（多结果事件里是该选项的问题） */
  title: LocalizedText;
  /** 多结果事件中的选项名；二元市场为 null */
  outcomeLabel: LocalizedText | null;
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
  /** 市场问题；界面直接用它，不再回查静态夹具 */
  title: LocalizedText;
  /** 多结果事件中的选项名；平台持仓接口不给时为 null */
  outcomeLabel: LocalizedText | null;
  /** 市场截止时间；平台不给时为 null */
  endsAt: string | null;
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
  /** 争议保证金；平台不暴露时缺省 */
  bond?: Money;
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
  | "CONVERSION"
  | "MAKER_REBATE"
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
  /** 平台排行榜不给胜率时缺省 */
  winRatePct?: number;
};

export type LeaderboardPeriod = "today" | "week" | "month" | "all";

export type PredictTx = Tx & {
  kind: "deposit" | "withdraw" | "redeem" | "split" | "merge" | "dispute";
};
