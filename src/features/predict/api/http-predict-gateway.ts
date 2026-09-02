import type { Page, Unsubscribe } from "../../../core/gateways/types";
import { money, type Money } from "../../../core/money/money";
import type { PredictServiceConfig } from "../../../core/config/bootstrap.schema";
import {
  fetchFeeRateBps,
  fetchOrderBook,
  fetchPriceHistory,
  type PriceHistoryInterval,
} from "../../../core/predict-platform/clob-market";
import {
  cancelOpenOrder,
  fetchOpenOrders,
  type ClobOpenOrder,
} from "../../../core/predict-platform/clob-orders";
import {
  fetchActivity,
  fetchLeaderboard,
  fetchPositions,
  fetchUserPnl,
  type PlatformActivity,
  type PlatformPosition,
  type PnlInterval,
} from "../../../core/predict-platform/data-positions";
import {
  displayPrice,
  fetchCarouselTags,
  fetchEvent,
  fetchEvents,
  fetchMarketsByCondition,
  translationOf,
  type GammaEvent,
  type GammaMarket,
  type GammaTag,
} from "../../../core/predict-platform/gamma";
import type {
  Activity,
  ActivityType,
  Adjudication,
  EventQuery,
  LeaderboardEntry,
  LeaderboardPeriod,
  Market,
  MarketEvent,
  MarketStatus,
  Order,
  OrderBook,
  OrderPreview,
  OrderResult,
  Outcome,
  PlaceOrderRequest,
  PnlPoint,
  Position,
  PredictEvent,
  PredictTx,
  PriceRange,
  PricePoint,
  Tag,
} from "../model/predict";
import type { PredictGateway } from "./gateway";
import type { HttpPredictAccountGateway } from "./http-predict-account-gateway";

/**
 * 真实平台的行情 / 持仓 / 订单网关（阶段 6）。映射规则见设计文档 §2.9 末尾：
 * `Market.id` = conditionId，`PredictEvent.id` = gamma 事件 id，价格换成整数分，
 * 金额用 6 位 USDC 的 Money。
 *
 * 平台没有的能力（争议提交）如实抛 `PredictUnsupportedError`；还没接入的能力
 * （下单 / 领取 / 拆合 / WS 推送）同样抛出，不用演示数据顶上。
 */

export class PredictUnsupportedError extends Error {
  constructor(
    readonly capability: string,
    detail: string,
  ) {
    super(detail);
    this.name = "PredictUnsupportedError";
  }
}

const USDC_DECIMALS = 6;

function cents(price: number | null): number {
  return price === null ? 0 : Math.round(price * 100);
}

function usdc(amount: number): Money {
  return money(BigInt(Math.round(amount * 1_000_000)), USDC_DECIMALS, "USDC");
}

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function outcomeOf(index: number, name: string | null | undefined): Outcome {
  if (index === 0) return "yes";
  if (index === 1) return "no";
  return (name ?? "").toLowerCase() === "yes" ? "yes" : "no";
}

function outcomeFromText(text: string | null | undefined): Outcome | undefined {
  const lowered = (text ?? "").trim().toLowerCase();
  if (lowered === "yes") return "yes";
  if (lowered === "no") return "no";
  return undefined;
}

/** 平台 adjudication 状态 → 我们的展示状态（`adapters.ts:198-212`、`polymarket.ts:100-135`） */
function marketStatusOf(market: GammaMarket, event: GammaEvent): MarketStatus {
  const adj = market.adjudication;
  if (adj?.settledOutcome) return "settled";
  if (adj?.challenger) return "disputed";
  if (adj?.proposedOutcome) return "result_proposed";
  if (market.closed || event.closed) return "awaiting_result";
  return "trading";
}

const ACTIVITY_TYPES: Record<string, ActivityType> = {
  TRADE: "TRADE",
  SPLIT: "SPLIT",
  MERGE: "MERGE",
  REDEEM: "REDEEM",
  CONVERSION: "CONVERSION",
  MAKER_REBATE: "MAKER_REBATE",
};

const HISTORY: Record<
  PriceRange,
  { interval: PriceHistoryInterval; windowSeconds: number | null }
> = {
  "1h": { interval: "1d", windowSeconds: 3_600 },
  "6h": { interval: "1d", windowSeconds: 6 * 3_600 },
  "1d": { interval: "1d", windowSeconds: null },
  "1w": { interval: "1w", windowSeconds: null },
  "1m": { interval: "1m", windowSeconds: null },
  all: { interval: "max", windowSeconds: null },
};

const PNL_INTERVAL: Record<PriceRange, PnlInterval> = {
  "1h": "1d",
  "6h": "1d",
  "1d": "1d",
  "1w": "1w",
  "1m": "1m",
  all: "all",
};

const LEADERBOARD_PERIOD: Record<
  LeaderboardPeriod,
  "DAY" | "WEEK" | "MONTH" | "ALL"
> = { today: "DAY", week: "WEEK", month: "MONTH", all: "ALL" };

type MarketRef = {
  conditionId: string;
  yesTokenId: string;
  noTokenId: string;
  eventId: string;
  negRisk: boolean;
};

export class HttpPredictGateway implements PredictGateway {
  /** conditionId → 代币 id 与事件（列表 / 详情读到就记下，订单簿与持仓靠它找代币） */
  private readonly markets = new Map<string, MarketRef>();
  private warnedSubscribe = false;

  constructor(private readonly deps: { account: HttpPredictAccountGateway }) {}

  private async service(): Promise<PredictServiceConfig> {
    return (await this.deps.account.platformContext()).service;
  }

  // ---- 映射 ----

  private mapTag(tag: GammaTag, index: number): Tag {
    return {
      id: tag.id,
      slug: tag.slug ?? tag.id,
      label: translationOf(
        tag.labelTranslation,
        tag.label ?? tag.slug ?? tag.id,
      ),
      order: index,
    };
  }

  private mapMarket(
    market: GammaMarket,
    event: GammaEvent,
    multi: boolean,
  ): Market | null {
    const [yesTokenId, noTokenId] = market.clobTokenIds;
    // 没有两个 CLOB 代币的市场无法交易也无法看簿，不列出来
    if (!yesTokenId || !noTokenId) return null;
    const negRisk = market.negRisk ?? event.negRisk ?? false;
    this.markets.set(market.conditionId, {
      conditionId: market.conditionId,
      yesTokenId,
      noTokenId,
      eventId: event.id,
      negRisk,
    });
    const question = translationOf(
      market.questionTranslation,
      market.question ?? event.title ?? "",
    );
    return {
      id: market.conditionId,
      eventId: event.id,
      outcomeLabel:
        multi && market.groupItemTitle
          ? { default: market.groupItemTitle }
          : undefined,
      question,
      yesPriceCents: cents(displayPrice(market)),
      volumeUsd: market.volume ?? 0,
      endsAt: market.endDate ?? event.endDate ?? "",
      yesTokenId,
      noTokenId,
    };
  }

  private mapEvent(event: GammaEvent): PredictEvent {
    const rawMarkets = event.markets ?? [];
    const multi = (event.numMarkets ?? rawMarkets.length) > 1;
    const markets = rawMarkets
      .map((market) => this.mapMarket(market, event, multi))
      .filter((market): market is Market => market !== null);
    const tags = event.tags ?? [];
    const sports = tags.some(
      (tag) => tag.tagType === "sport" || tag.tagType === "league",
    );
    const primary = rawMarkets[0];
    return {
      id: event.id,
      slug: event.slug ?? event.id,
      title: translationOf(event.titleTranslation, event.title ?? ""),
      kind: sports ? "sports" : multi ? "multi" : "binary",
      categoryTagId: tags[0]?.id ?? "",
      tagIds: tags.map((tag) => tag.id),
      markets,
      volumeUsd: multi
        ? rawMarkets.reduce((sum, market) => sum + (market.volume ?? 0), 0)
        : (primary?.volume ?? event.volume ?? 0),
      // 平台不提供持有人数
      holders: null,
      endsAt: (!multi ? primary?.endDate : undefined) ?? event.endDate ?? "",
      featured: event.featured ?? false,
      rules: { default: event.description ?? "" },
      resolutionSource: { default: event.resolutionSource ?? "" },
      // 费率按代币从 clob 读（getFeeBps），事件级没有
      feeBps: 0,
      disputeWindowSec: primary?.adjudication?.livenessSecs ?? 0,
    };
  }

  private async marketRef(conditionId: string): Promise<MarketRef> {
    const known = this.markets.get(conditionId);
    if (known) return known;
    const service = await this.service();
    const [market] = await fetchMarketsByCondition(service, [conditionId]);
    if (!market)
      throw new Error(`market ${conditionId} is unknown to the platform`);
    const [yesTokenId, noTokenId] = market.clobTokenIds;
    if (!yesTokenId || !noTokenId)
      throw new Error(`market ${conditionId} has no CLOB tokens`);
    const ref: MarketRef = {
      conditionId,
      yesTokenId,
      noTokenId,
      eventId: market.eventSlug ?? "",
      negRisk: market.negRisk ?? false,
    };
    this.markets.set(conditionId, ref);
    return ref;
  }

  private mapPosition(position: PlatformPosition): Position {
    const outcome = outcomeOf(position.outcomeIndex, position.outcome);
    const closed = position.marketClosed ?? false;
    const status: MarketStatus = closed
      ? position.redeemable
        ? "settled"
        : "awaiting_result"
      : "trading";
    return {
      id: `${position.conditionId}:${position.asset}`,
      marketId: position.conditionId,
      eventId: position.eventSlug ?? position.slug ?? "",
      outcome,
      shares: position.size,
      avgPriceCents: cents(position.avgPrice),
      curPriceCents: cents(position.curPrice),
      value: usdc(position.currentValue),
      costBasis: usdc(position.initialValue),
      pnl: usdc(position.cashPnl),
      pnlPct: position.percentPnl,
      status,
      redeemable: position.redeemable ?? false,
      closed: position.size <= 0,
    };
  }

  private mapActivity(item: PlatformActivity, index: number): Activity {
    const type = ACTIVITY_TYPES[item.type.toUpperCase()] ?? "TRADE";
    const side = (item.side ?? "").toUpperCase();
    // 正为入账：卖出 / 领取 / 合并 / 返佣进来，买入 / 拆分出去
    const inflow =
      type === "REDEEM" ||
      type === "MERGE" ||
      type === "MAKER_REBATE" ||
      (type === "TRADE" && side === "SELL");
    const amount = usdc(inflow ? item.usdcSize : -item.usdcSize);
    return {
      id: item.id ?? `${item.type}:${item.timestamp}:${item.asset ?? index}`,
      type,
      marketId: item.conditionId ?? undefined,
      eventId: item.eventSlug ?? item.slug ?? undefined,
      title: translationOf(item.questionTranslation, item.title ?? ""),
      amount,
      detail:
        type === "TRADE"
          ? {
              default: `${side} ${item.size} ${item.outcome ?? ""} @ ${item.price}`,
            }
          : undefined,
      at: iso(item.timestamp),
    };
  }

  private mapOrder(order: ClobOpenOrder, eventId: string): Order {
    const type = (order.order_type ?? "").toUpperCase();
    const createdAt =
      typeof order.created_at === "number"
        ? iso(order.created_at)
        : (order.created_at ?? new Date(0).toISOString());
    const expiration = Number(order.expiration ?? 0);
    return {
      id: order.id,
      marketId: order.market,
      eventId,
      outcome: outcomeFromText(order.outcome) ?? "yes",
      side: order.side.toUpperCase() === "SELL" ? "sell" : "buy",
      type: type === "MARKET" || type === "FAK" ? "market" : "limit",
      priceCents: cents(order.price),
      shares: order.original_size,
      filledShares: order.size_matched,
      tif: expiration > 0 ? "GTD" : "GTC",
      expiresAt: expiration > 0 ? iso(expiration) : undefined,
      createdAt,
      // fetchOpenOrders 已只留未完成的：部分成交也算 open，界面按 filledShares 显示进度
      status: "open",
    };
  }

  // ---- 公开行情 ----

  async listTags(): Promise<Tag[]> {
    const service = await this.service();
    const tags = await fetchCarouselTags(service);
    return tags.map((tag, index) => this.mapTag(tag, index));
  }

  async listEvents(query: EventQuery): Promise<Page<PredictEvent>> {
    if (query.search)
      throw new PredictUnsupportedError(
        "search",
        "event search is not wired to the platform yet",
      );
    const service = await this.service();
    const limit = query.limit ?? 20;
    const offset = query.cursor ? Number(query.cursor) : 0;
    const events = await fetchEvents(service, {
      tagId: query.tagId,
      featured: query.featured,
      order:
        query.sort === "endingSoon"
          ? "end_date_iso"
          : query.sort === "newest"
            ? "created_at"
            : "volume",
      limit,
      offset,
    });
    return {
      items: events.map((event) => this.mapEvent(event)),
      nextCursor: events.length === limit ? String(offset + limit) : null,
    };
  }

  async getEvent(slugOrId: string): Promise<PredictEvent> {
    const service = await this.service();
    return this.mapEvent(await fetchEvent(service, slugOrId));
  }

  async getOrderBook(marketId: string): Promise<OrderBook> {
    const service = await this.service();
    const ref = await this.marketRef(marketId);
    const book = await fetchOrderBook(service, ref.yesTokenId);
    const stamp = Number(book.timestamp ?? 0);
    const updatedAt =
      stamp > 1e12 ? new Date(stamp).toISOString() : iso(stamp || 0);
    const level = (item: { price: number; size: number }) => ({
      priceCents: cents(item.price),
      shares: item.size,
    });
    return {
      marketId,
      bids: book.bids.map(level),
      asks: book.asks.map(level),
      tickCents: (book.tick_size ?? 0.01) * 100,
      updatedAt,
    };
  }

  async getPriceHistory(
    marketId: string,
    range: PriceRange,
  ): Promise<PricePoint[]> {
    const service = await this.service();
    const ref = await this.marketRef(marketId);
    const { interval, windowSeconds } = HISTORY[range];
    const points = await fetchPriceHistory(service, {
      tokenId: ref.yesTokenId,
      interval,
    });
    const since =
      windowSeconds === null
        ? 0
        : Math.floor(Date.now() / 1000) - windowSeconds;
    return points
      .filter((point) => point.t >= since)
      .map((point) => ({ t: iso(point.t), priceCents: cents(point.p) }));
  }

  subscribeMarkets(
    _marketIds: string[],
    _onEvent: (event: MarketEvent) => void,
  ): Unsubscribe {
    // WS 推送在下一阶段接入（§2.9 WS 行情）；在此之前界面只有拉取到的数据，不模拟推送
    if (!this.warnedSubscribe) {
      this.warnedSubscribe = true;
      console.warn(
        "[predict] market WebSocket is not wired yet; no live updates",
      );
    }
    return () => {};
  }

  async getFeeBps(marketId: string): Promise<number> {
    const service = await this.service();
    const ref = await this.marketRef(marketId);
    return fetchFeeRateBps(service, ref.yesTokenId);
  }

  async getAdjudication(marketId: string): Promise<Adjudication> {
    const service = await this.service();
    const [market] = await fetchMarketsByCondition(service, [marketId]);
    if (!market)
      throw new Error(`market ${marketId} is unknown to the platform`);
    const adj = market.adjudication;
    const event: GammaEvent = {
      id: market.eventSlug ?? "",
      closed: market.closed ?? null,
      markets: [market],
    } as GammaEvent;
    return {
      marketId,
      status: marketStatusOf(market, event),
      endsAt: market.endDate ?? "",
      proposedOutcome: outcomeFromText(adj?.proposedOutcome),
      proposedAt: adj?.proposedAt ?? undefined,
      disputeDeadline: adj?.livenessDeadline ?? undefined,
      disputeWindowSec: adj?.livenessSecs ?? 0,
      // 平台网页没有争议提交入口（§2.9）
      canDispute: false,
      disputedAt: adj?.challengedAt ?? undefined,
      disputedBy: adj?.challenger ?? undefined,
      settledOutcome: outcomeFromText(adj?.settledOutcome),
      settledAt: adj?.resolvedAt ?? undefined,
    };
  }

  // ---- 订单 ----

  async previewOrder(
    _address: string,
    _request: PlaceOrderRequest,
  ): Promise<OrderPreview> {
    throw new PredictUnsupportedError(
      "orders",
      "order placement is not wired to the platform yet",
    );
  }

  async placeOrder(
    _address: string,
    _request: PlaceOrderRequest,
  ): Promise<OrderResult> {
    throw new PredictUnsupportedError(
      "orders",
      "order placement is not wired to the platform yet",
    );
  }

  async listOpenOrders(address: string, marketId?: string): Promise<Order[]> {
    const ctx = await this.deps.account.tradingContext(address);
    const orders = await fetchOpenOrders(
      ctx.service,
      { credentials: ctx.clob, address },
      marketId,
    );
    const result: Order[] = [];
    for (const order of orders) {
      const ref = await this.marketRef(order.market);
      result.push(this.mapOrder(order, ref.eventId));
    }
    return result;
  }

  async cancelOrder(address: string, orderId: string): Promise<void> {
    const ctx = await this.deps.account.tradingContext(address);
    await cancelOpenOrder(
      ctx.service,
      { credentials: ctx.clob, address },
      orderId,
    );
  }

  // ---- 持仓 / 活动 / 盈亏 ----

  async listPositions(
    address: string,
    options?: { includeClosed?: boolean },
  ): Promise<Position[]> {
    const ctx = await this.deps.account.tradingContext(address);
    const open = await fetchPositions(ctx.service, ctx.safe);
    const closed = options?.includeClosed
      ? await fetchPositions(ctx.service, ctx.safe, { closed: true })
      : [];
    return [
      ...open.map((item) => this.mapPosition(item)),
      ...closed.map((item) => ({ ...this.mapPosition(item), closed: true })),
    ];
  }

  async listActivity(address: string): Promise<Activity[]> {
    const ctx = await this.deps.account.tradingContext(address);
    const items = await fetchActivity(ctx.service, ctx.safe);
    return items.map((item, index) => this.mapActivity(item, index));
  }

  async getPnl(address: string, range: PriceRange): Promise<PnlPoint[]> {
    const ctx = await this.deps.account.tradingContext(address);
    const points = await fetchUserPnl(
      ctx.service,
      ctx.safe,
      PNL_INTERVAL[range],
    );
    return points.map((point) => ({ t: iso(point.t), pnlUsd: point.p }));
  }

  async redeem(_address: string, _positionIds: string[]): Promise<PredictTx> {
    throw new PredictUnsupportedError(
      "redeem",
      "redeeming is not wired to the platform yet",
    );
  }

  async splitOrMerge(): Promise<PredictTx> {
    throw new PredictUnsupportedError(
      "split-merge",
      "split / merge is not wired to the platform yet",
    );
  }

  async submitDispute(): Promise<PredictTx> {
    throw new PredictUnsupportedError(
      "dispute",
      "the platform has no dispute submission for users",
    );
  }

  async getTx(_id: string): Promise<PredictTx | null> {
    return null;
  }

  async getLeaderboard(
    period: LeaderboardPeriod,
    sort: "pnl" | "volume",
  ): Promise<LeaderboardEntry[]> {
    const service = await this.service();
    const entries = await fetchLeaderboard(service, {
      orderBy: sort === "pnl" ? "PNL" : "VOL",
      timePeriod: LEADERBOARD_PERIOD[period],
    });
    return entries.map((entry) => ({
      rank: entry.rank,
      address: entry.proxyWallet,
      name: entry.userName ?? undefined,
      pnlUsd: entry.pnl,
      volumeUsd: entry.vol,
    }));
  }
}
