import type { Page, Unsubscribe } from "../../../core/gateways/types";
import type { Money } from "../../../core/money/money";
import type {
  Activity,
  Adjudication,
  EventQuery,
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
  Tag,
} from "../model/predict";

/**
 * Predict 领域网关（行情 / 下单 / 持仓）：目前由 MockPredictGateway 实现，后续逐步接入
 * 真实平台。**账户（余额、转入、转出）不在这里**——它已经接真实平台，见
 * `account-gateway.ts`，没有 Mock 实现。
 * 所有读写都带 address（钱包地址 = 用户主体）；游客可调用无需 address 的方法。
 */
export interface PredictGateway {
  listTags(): Promise<Tag[]>;
  listEvents(query: EventQuery): Promise<Page<PredictEvent>>;
  getEvent(slugOrId: string): Promise<PredictEvent>;
  getOrderBook(marketId: string): Promise<OrderBook>;
  getPriceHistory(marketId: string, range: PriceRange): Promise<PricePoint[]>;
  subscribeMarkets(
    marketIds: string[],
    onEvent: (event: MarketEvent) => void,
  ): Unsubscribe;
  getFeeBps(marketId: string): Promise<number>;
  getAdjudication(marketId: string): Promise<Adjudication>;

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

  submitDispute(
    address: string,
    marketId: string,
    reason: string,
  ): Promise<PredictTx>;
  /** 存入 / 取回 / 领取 / 拆合 / 争议 交易状态（轮询） */
  getTx(id: string): Promise<PredictTx | null>;
  getLeaderboard(
    period: LeaderboardPeriod,
    sort: "pnl" | "volume",
  ): Promise<LeaderboardEntry[]>;
}
