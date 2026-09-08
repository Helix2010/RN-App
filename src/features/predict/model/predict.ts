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
  | "settled"
  /** 平台取消的市场：不再结算，持仓按平台规则退回 */
  | "canceled";

export type Outcome = "yes" | "no";

export type Tag = {
  id: string;
  slug: string;
  label: LocalizedText;
  order: number;
};

export type Market = {
  id: string;
  /** 市场图标（gamma `icon`）；平台没给就是 null，界面不占位 */
  iconUrl: string | null;
  eventId: string;
  /** 多结果事件中该市场代表的选项名（如"法国"、"降 25 bp"）；二元市场为空 */
  outcomeLabel?: LocalizedText;
  question: LocalizedText;
  /** YES 展示价（分）。平台暂无报价（无买卖盘也无成交）时为 null，界面显示占位而不编数 */
  yesPriceCents: number | null;
  volumeUsd: number;
  volume24hUsd: number;
  liquidityUsd: number;
  endsAt: string;
  /** 交易已截止（平台 closed）；结果见 result */
  closed: boolean;
  /** 已结算的胜方；未结算为 null */
  result: Outcome | null;
  /** 平台当前是否接单；不接单时买卖按钮禁用 */
  acceptingOrders: boolean;
  /** 市场级规则说明（与事件级规则不同的那部分）；平台没给时缺省 */
  description?: LocalizedText;
  yesTokenId: string;
  noTokenId: string;
};

export type PredictEvent = {
  id: string;
  /** 事件横幅图与图标（gamma `image` / `icon`）；平台没给就是 null，界面不占位 */
  imageUrl: string | null;
  iconUrl: string | null;
  slug: string;
  title: LocalizedText;
  kind: EventKind;
  categoryTagId: string;
  /** 展示用分类标签 = 首个标签的多语言名称（categoryTagId 只用于筛选） */
  category: LocalizedText;
  tagIds: string[];
  /** 事件的全部标签（详情页展示）；顺序即平台顺序 */
  tags: Tag[];
  markets: Market[];
  volumeUsd: number;
  volume24hUsd: number;
  liquidityUsd: number;
  /** 事件已截止（平台 closed） */
  closed: boolean;
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
  /** liquidity 平台不支持服务端排序，网关按当前页本地排序 */
  sort?: "volume" | "volume24h" | "liquidity" | "endingSoon" | "newest";
  /** 默认只列交易中的事件；closed = 已截止 / 已结算；all = 不过滤 */
  status?: "trading" | "closed" | "all";
  cursor?: string | null;
  limit?: number;
};

/** 首页策展：平台运营在 /curation/events 里给事件排的位置 */
export type CuratedEvent = {
  event: PredictEvent;
  /** 英雄轮播位次；不在该区为 null */
  hero: number | null;
  /** 高亮区位次 */
  highlight: number | null;
  /** 普通区位次 */
  normal: number | null;
};

export type Holder = {
  /** 持仓地址（平台代理钱包） */
  address: string;
  /** 平台公开的用户名或匿名；两者都没有为 null */
  name: string | null;
  shares: number;
};
export type HolderGroup = { outcome: Outcome; holders: Holder[] };

/** 周期性市场系列（如 BTC 5 分钟涨跌） */
export type Series = {
  id: string;
  slug: string;
  title: LocalizedText;
  /** 平台的周期文本（5m / 15m / 1h …） */
  recurrence: string;
  seriesType: string;
  /** 标的代号（gamma `ticker`，如 BTCUSD）；平台没给就是 null，由 slug / 标题推断 */
  ticker: string | null;
};
export type SeriesPeriodPrice = {
  price: string;
  /** 取价来源：chainlink 实时 / chainlink-candle K 线兜底 */
  source: string;
  sampledAt?: string;
};
/** 系列的一期：一个固定时间窗口，对应一个事件 / 市场 */
export type SeriesPeriod = {
  id: string;
  seriesId: string;
  eventId: string;
  /** 交易用的 conditionId；平台没把事件带回来时为 null（不用 gamma 数字 id 冒充） */
  marketId: string | null;
  windowStart: string;
  windowEnd: string;
  /** 平台阶段：generated / publishing / published / closing / proposed / settled / failed / held */
  stage: string;
  priceToBeat: SeriesPeriodPrice | null;
  finalPrice: SeriesPeriodPrice | null;
  result: "up" | "down" | null;
  /** 上游声明的结算取价源；实时价订阅按它选流 */
  resolutionSource: string | null;
  /** 该期对应的事件（带市场与代币），平台带出时才有 */
  event?: PredictEvent;
};

/** 实时数据服务（RTDS）的取价源与订阅参数（`/recurring/live-source`） */
export type CryptoLiveSource = {
  symbol: string;
  rtdsSymbol: string;
  source: string;
  topic: string;
  /** WS 订阅的 filters 字符串（JSON 文本，原样回传） */
  filters: string;
  /** true = 流来自上游对该期的取价声明（与结算同源）；false = 按周期兜底映射 */
  declared: boolean;
};
export type CryptoTick = { t: number; value: number; source: string };
export type CryptoCandle = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
};

export type OrderBookLevel = { priceCents: number; shares: number };
/**
 * YES 代币的订单簿：按 tick 聚合、买盘从高到低、卖盘从低到高（同网页版 `pmOrderBookToSnapshot`）。
 * No 侧盘口是它的镜像（买 No @ p ≡ 卖 Yes @ 100 − p），由界面推导。
 */
export type OrderBook = {
  marketId: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  tickCents: number;
  /** clob 对该代币的最小下单份数（`/book` 的 min_order_size；不足会被 400 拒绝） */
  minOrderShares: number;
  /** 最近成交价（分）；簿与推送都没给过就是 null */
  lastTradeCents: number | null;
  updatedAt: string;
};
export type PricePoint = { t: string; priceCents: number };
export type PriceRange = "1h" | "6h" | "1d" | "1w" | "1m" | "all";

/** 一笔公开成交（data-service `/trades`）：YES 视角的价格 */
export type Trade = {
  id: string;
  marketId: string;
  outcome: Outcome;
  side: OrderSide;
  priceCents: number;
  shares: number;
  at: string;
  hash?: string;
};

export type MarketEvent =
  | { type: "price_change"; marketId: string; yesPriceCents: number }
  | { type: "book"; book: OrderBook }
  | { type: "last_trade"; marketId: string; priceCents: number };

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
  /** canceled：市价（FAK）单一份都没成交，平台已撤单（match_dispatcher.go:1922-1930） */
  status: "filled" | "open" | "partial" | "delayed" | "canceled";
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
  /** 争议保证金；平台不暴露时缺省（真实平台要读链，见 DisputeTerms） */
  bond?: Money;
  /** 现在能不能提出争议：以平台算好的阶段为准（liveness_period 且适配器有争议环节且还没人争议） */
  canDispute: boolean;
  /** 平台的阶段原值（gamma currentPhase），不自己从字段推 */
  phase?: string;
  /** 市场适配器实例（regular / neg_risk / sports / crypto_periodic）；crypto_periodic 没有争议环节 */
  adapter?: string;
  /** 链上争议的键（LightOracle 请求四元组）；平台没给或适配器合约缺失时缺省 */
  disputeKey?: DisputeKey;
  disputedAt?: string;
  disputedBy?: string;
  settledOutcome?: Outcome;
  settledAt?: string;
};

export type DisputeKey = {
  /** 作为 requester 的适配器地址 */
  requester: string;
  /** bytes32 identifier（YES_OR_NO_QUERY / MULTIPLE_VALUES） */
  identifier: string;
  /** uint256，十进制字符串 */
  requestTimestamp: string;
  /** bytes，0x 前缀 */
  ancillaryData: string;
};

/** 争议条款：链上押金与到期，加上本地址（EOA）的相关余额。面板打开时读，倒计时以链上到期为准。 */
export type DisputeTerms = {
  bond: Money;
  /** LightOracle 请求的 expirationTime（ISO） */
  expiresAt: string;
  oracle: string;
  usdwBalance: Money;
  /** 钱包里可兑换成 USDW 的底层 USDC */
  usdcBalance: Money;
  /** 付 gas 的原生币余额 */
  nativeBalance: Money;
};

export type DisputeStep = "evidence" | "bond" | "approve" | "dispute";

export type DisputeInput = {
  evidence: string;
  links: string[];
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

/** 地区限制检查结果（`core/predict-platform/geo.ts`）：没配检查服务时 checked=false */
export type { RegionAccess } from "../../../core/predict-platform/geo";
