import type { Page, Unsubscribe } from "../../../core/gateways/types";
import type { Money } from "../../../core/money/money";
import type {
  CryptoCandle,
  CryptoLiveSource,
  CryptoTick,
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
  SeriesPeriodPage,
  Tag,
  Trade,
  DisputeInput,
  DisputeStep,
  DisputeTerms,
  SearchQuery,
  SearchPage,
} from "../model/predict";

/**
 * Predict 领域网关（行情 / 下单 / 持仓）：生产由 `HttpPredictGateway` 接 pm-cup2026 平台
 * （gamma / clob / data / relayer / clob-ws），`MockPredictGateway` 只给测试用。
 * **账户（余额、转入、转出）不在这里**——见 `account-gateway.ts`，同样只有真实实现。
 * 所有读写都带 address（钱包地址 = 用户主体）；游客可调用无需 address 的方法。
 */
export interface PredictGateway {
  /** 一级分类：平台轮播标签 */
  listTags(): Promise<Tag[]>;
  /** 单个标签（`/tags/{id}`）：只用于解析深链带进来、不在轮播里的一级标签 */
  getTag(tagId: string): Promise<Tag>;
  /** 一级标签下的二级标签（`/tags/{id}/related-tags/tags`）；没有就是空数组 */
  listRelatedTags(tagId: string): Promise<Tag[]>;
  listEvents(query: EventQuery): Promise<Page<PredictEvent>>;
  /** 全站搜索（`/public-search`），page 从 1 起 */
  searchEvents(query: SearchQuery): Promise<SearchPage>;
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
  /** 分期：current = 进行中 + 未来期；closed = 历史期，可按上一页的 nextCursor 往前翻 */
  listSeriesPeriods(
    seriesId: string,
    scope: "current" | "closed",
    limit?: number,
    cursor?: string,
  ): Promise<SeriesPeriodPage>;
  /** 地区限制：租户没配检查服务时 `{restricted:false, checked:false}`；服务不可用时抛错，不放行 */
  checkRegion(): Promise<RegionAccess>;
  // ---- 实时数据服务（周期市场的标的价） ----
  /** 按周期 / 结算声明解析取价源与 WS 订阅参数 */
  getCryptoLiveSource(input: {
    symbol: string;
    recurrence?: string;
    resolutionSource?: string | null;
  }): Promise<CryptoLiveSource>;
  getCryptoLatest(symbol: string, source: string): Promise<CryptoTick>;
  /** 最近的 tick 历史（价格图回填），按时间升序 */
  getCryptoPriceHistory(
    symbol: string,
    source: string,
    limit: number,
  ): Promise<CryptoTick[]>;
  /** 1 分钟 K 线，按时间升序；source 只能是有 K 线的真实源（binance）；endTime（毫秒）= 只要该时刻之前的，看历史期用 */
  getCryptoCandles(
    symbol: string,
    interval: "1m" | "5m" | "15m" | "1h",
    limit: number,
    source: string,
    endTime?: number,
  ): Promise<CryptoCandle[]>;
  /** 订阅实时价；返回取消函数 */
  subscribeCryptoPrice(
    source: CryptoLiveSource,
    listener: (tick: CryptoTick) => void,
  ): () => void;

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
