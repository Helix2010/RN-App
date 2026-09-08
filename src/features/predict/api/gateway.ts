import type { Page, Unsubscribe } from "../../../core/gateways/types";
import type { Money } from "../../../core/money/money";
import type {
  RegionAccess,
  Activity,
  Adjudication,
  CuratedEvent,
  EventQuery,
  HolderGroup,
  LeaderboardEntry,
  LeaderboardPeriod,
  MarketEvent,
  Order,
  OrderBook,
  OrderPreview,
  OrderResult,
  PlaceOrderRequest,
  PnlPoint,
  Position,
  PredictEvent,
  PredictTx,
  PriceRange,
  PricePoint,
  Series,
  SeriesPeriod,
  Tag,
  Trade,
  DisputeInput,
  DisputeStep,
  DisputeTerms,
} from "../model/predict";

/**
 * Predict 领域网关（行情 / 下单 / 持仓）：生产由 `HttpPredictGateway` 接 pm-cup2026 平台
 * （gamma / clob / data / relayer / clob-ws），`MockPredictGateway` 只给测试用。
 * **账户（余额、转入、转出）不在这里**——见 `account-gateway.ts`，同样只有真实实现。
 * 所有读写都带 address（钱包地址 = 用户主体）；游客可调用无需 address 的方法。
 */
export interface PredictGateway {
  listTags(): Promise<Tag[]>;
  listEvents(query: EventQuery): Promise<Page<PredictEvent>>;
  getEvent(slugOrId: string): Promise<PredictEvent>;
  getOrderBook(marketId: string): Promise<OrderBook>;
  getPriceHistory(marketId: string, range: PriceRange): Promise<PricePoint[]>;
  /** 最近成交（按时间倒序），用于成交列表与稀疏历史的补点 */
  listTrades(marketId: string, limit?: number): Promise<Trade[]>;
  subscribeMarkets(
    marketIds: string[],
    onEvent: (event: MarketEvent) => void,
  ): Unsubscribe;
  getFeeBps(marketId: string): Promise<number>;
  getAdjudication(marketId: string): Promise<Adjudication>;
  /** 首页策展位（英雄 / 高亮 / 普通三区），平台没配时为空数组 */
  listCuratedEvents(): Promise<CuratedEvent[]>;
  /** 按结果分组的持有人榜（data-service /holders） */
  getHolders(marketId: string): Promise<HolderGroup[]>;
  /** 周期性系列（BTC 5m 涨跌等）与分期 */
  listSeries(): Promise<Series[]>;
  /** 按 slug 取系列，能给 id 就一起给（同名 slug 定位） */
  getSeries(slug: string, id?: string): Promise<Series>;
  listSeriesPeriods(
    seriesId: string,
    scope: "current" | "closed",
    limit?: number,
  ): Promise<SeriesPeriod[]>;
  /** 地区限制：租户没配检查服务时 `{restricted:false, checked:false}`；服务不可用时抛错，不放行 */
  checkRegion(): Promise<RegionAccess>;

  previewOrder(
    address: string,
    request: PlaceOrderRequest,
  ): Promise<OrderPreview>;
  placeOrder(address: string, request: PlaceOrderRequest): Promise<OrderResult>;
  listOpenOrders(address: string, marketId?: string): Promise<Order[]>;
  cancelOrder(address: string, orderId: string): Promise<void>;
  listPositions(
    address: string,
    options?: { includeClosed?: boolean },
  ): Promise<Position[]>;
  listActivity(address: string): Promise<Activity[]>;
  getPnl(address: string, range: PriceRange): Promise<PnlPoint[]>;
  redeem(address: string, positionIds: string[]): Promise<PredictTx>;
  splitOrMerge(
    address: string,
    marketId: string,
    direction: "split" | "merge",
    amount: Money,
  ): Promise<PredictTx>;

  /** 争议条款：链上押金与到期、本地址余额；只对 canDispute 的市场有意义 */
  getDisputeTerms(address: string, marketId: string): Promise<DisputeTerms>;
  /**
   * 四步争议（review-2026-09-05 §4.3）：证据登记 → 押金核对 → 授权 → 链上 disputePrice，
   * 每步进 onStep。押金不够抛 PredictInsufficientBondError，可预期失败抛 PredictDisputeError。
   */
  submitDispute(
    address: string,
    marketId: string,
    input: DisputeInput,
    onStep?: (step: DisputeStep) => void,
  ): Promise<PredictTx>;
  /** 押金不够时：把钱包里的 USDC 兑换成 USDW 到本地址（EOA），复用转入的 approve + wrap */
  wrapForDispute(
    address: string,
    amount: Money,
    onStep?: (step: "approve" | "wrap") => void,
  ): Promise<PredictTx>;
  /** 存入 / 取回 / 领取 / 拆合 / 争议 交易状态（轮询） */
  getTx(id: string): Promise<PredictTx | null>;
  getLeaderboard(
    period: LeaderboardPeriod,
    sort: "pnl" | "volume",
  ): Promise<LeaderboardEntry[]>;
}
