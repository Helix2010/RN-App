import type { LocalizedText } from "../../../core/i18n/localized-text";
import type { Page, Unsubscribe } from "../../../core/gateways/types";
import { money, type Money } from "../../../core/money/money";
import type { PredictServiceConfig } from "../../../core/config/bootstrap.schema";
import {
  fetchFeeRateBps,
  fetchOrderBook,
  fetchPriceHistory,
  fetchTickSize,
  type ClobOrderBook,
  type PriceHistoryInterval,
} from "../../../core/predict-platform/clob-market";
import {
  cancelOpenOrder,
  fetchOpenOrders,
  type ClobOpenOrder,
} from "../../../core/predict-platform/clob-orders";
import {
  ZERO_BYTES32,
  conditionalTokens,
  decodeUint,
  negRiskAdapter,
} from "../../../core/predict-platform/contracts";
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
import { computeOrderAmounts } from "../../../core/predict-platform/order-amounts";
import {
  postOrder,
  signOrder,
  type OrderType as ClobOrderType,
} from "../../../core/predict-platform/orders";
import {
  MarketWsClient,
  type SocketLike,
} from "../../../core/predict-platform/market-ws";
import { encodeMultiSend } from "../../../core/predict-platform/safe";
import { platformHosts } from "../../../core/predict-platform/tenant-client";
import type { WalletGateway } from "../../wallet/api/gateway";
import type { OnchainTransfers } from "../../wallet/api/onchain-transfers";
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
 * 下单：EIP-712 Order（maker = Safe、signer = EOA）→ `POST /order`；金额换算是 user-dapp
 * `orderAmounts.ts` 的逐行移植。领取 / 拆合：Safe 经 relayer 调 CTF（negRisk 走 adapter）。
 * 平台没有的能力（争议提交）与还没接的能力（WS 推送）如实抛 `PredictUnsupportedError`。
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

const SIGN_REASON = "predict.sign.reason";
/** 预测账户内的一切金额（成交额、持仓市值、盈亏、活动）都是 USDW（抵押品，6 位）——与账户余额同一单位才能比较 */
const USDW_DECIMALS = 6;
const ONE_USDC = 1_000_000n;

/** 价格（0–1）→ 分，保留一位小数：簿的 tick 可到 0.1¢，网页版概率也显示一位小数（utils.ts formatProbability） */
function cents(price: number): number {
  return Math.round(price * 1000) / 10;
}

/** 展示价可能缺失（gamma 没缓存买卖盘也没成交价），缺就 null 不编数 */
function centsOrNull(price: number | null): number | null {
  return price === null ? null : cents(price);
}

/**
 * 订单簿推出的 YES 概率（分）：mid → ask → bid，只认 0 < p < 100 的可成交价，
 * 同网页版 `orderbookPricing.ts` resolveFirstOptionProbability。
 */
/**
 * 簿时间戳：REST `/book` 给毫秒串，WS 初始 dump 给 ISO 串（实测 2026-09-03）；都解析不了就用收到的时刻。
 */
function bookTimestamp(raw: string | number | null | undefined): string {
  if (raw !== null && raw !== undefined && raw !== "") {
    const numeric = Number(raw);
    const ms = Number.isFinite(numeric)
      ? numeric > 1e12
        ? numeric
        : numeric * 1000
      : Date.parse(String(raw));
    if (Number.isFinite(ms) && ms > 0) return new Date(ms).toISOString();
  }
  return new Date().toISOString();
}

/** 可成交价：0 < p < 1（同网页版 isTradablePrice） */
function tradable(value: number | null): number | null {
  return value !== null && value > 0 && value < 1 ? value : null;
}

function bookMidCents(book: OrderBook): number | null {
  const tradable = (level: { priceCents: number }) =>
    level.priceCents > 0 && level.priceCents < 100;
  const bids = book.bids.filter(tradable).map((level) => level.priceCents);
  const asks = book.asks.filter(tradable).map((level) => level.priceCents);
  const bid = bids.length > 0 ? Math.max(...bids) : null;
  const ask = asks.length > 0 ? Math.min(...asks) : null;
  if (bid !== null && ask !== null)
    return Math.round(((bid + ask) / 2) * 10) / 10;
  return ask ?? bid;
}

function usdw(amount: number): Money {
  return money(BigInt(Math.round(amount * 1_000_000)), USDW_DECIMALS, "USDW");
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
  /** 市场问题与多结果选项名，给挂单 / 持仓行显示用 */
  question: LocalizedText;
  outcomeLabel: LocalizedText | null;
  /** gamma 的 orderMinSize；WS 簿事件没有 min_order_size 时用它 */
  minOrderShares: number | null;
};

/** 沿簿吃单的估算：市价买按预算吃卖单，卖出按份数吃买单 */
function walkBook(
  levels: { price: number; size: number }[],
  input: { budgetUsdc?: number; shares?: number },
): { shares: number; cost: number } {
  let shares = 0;
  let cost = 0;
  for (const level of levels) {
    if (input.budgetUsdc !== undefined) {
      const remaining = input.budgetUsdc - cost;
      if (remaining <= 0) break;
      const take = Math.min(level.size, remaining / level.price);
      shares += take;
      cost += take * level.price;
    } else {
      const remaining = (input.shares ?? 0) - shares;
      if (remaining <= 0) break;
      const take = Math.min(level.size, remaining);
      shares += take;
      cost += take * level.price;
    }
  }
  return { shares, cost };
}

function tagLabel(tag: GammaTag): LocalizedText {
  return translationOf(tag.labelTranslation, tag.label ?? tag.slug ?? tag.id);
}

export class HttpPredictGateway implements PredictGateway {
  /** conditionId → 代币 id 与事件（列表 / 详情读到就记下，订单簿与持仓靠它找代币） */
  private readonly markets = new Map<string, MarketRef>();
  /** 本进程里经 relayer 完成的链上交易（领取 / 拆合），供 getTx */
  private readonly txs = new Map<string, PredictTx>();
  /** 行情 WS 连接：第一次订阅时按租户域名建，所有市场共用 */
  private ws: MarketWsClient | null = null;
  private wsUrl: string | null = null;

  constructor(
    private readonly deps: {
      account: HttpPredictAccountGateway;
      wallet: WalletGateway;
      onchain: OnchainTransfers;
      now?: () => number;
      /** 仅供测试替换 WebSocket */
      createSocket?: (url: string) => SocketLike;
    },
  ) {}

  private async service(): Promise<PredictServiceConfig> {
    return (await this.deps.account.platformContext()).service;
  }

  private nowIso(): string {
    return new Date(this.deps.now?.() ?? Date.now()).toISOString();
  }

  // ---- 映射 ----

  private mapTag(tag: GammaTag, index: number): Tag {
    return {
      id: tag.id,
      slug: tag.slug ?? tag.id,
      label: tagLabel(tag),
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
    const question = translationOf(
      market.questionTranslation,
      market.question ?? event.title ?? "",
    );
    const outcomeLabel =
      multi && market.groupItemTitle
        ? { default: market.groupItemTitle }
        : undefined;
    this.markets.set(market.conditionId, {
      conditionId: market.conditionId,
      yesTokenId,
      noTokenId,
      eventId: event.id,
      negRisk,
      minOrderShares: market.orderMinSize,
      question,
      outcomeLabel: outcomeLabel ?? null,
    });
    return {
      id: market.conditionId,
      eventId: event.id,
      outcomeLabel,
      question,
      yesPriceCents: centsOrNull(displayPrice(market)),
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
      category: tags[0] ? tagLabel(tags[0]) : {},
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
      minOrderShares: market.orderMinSize,
      question: translationOf(
        market.questionTranslation,
        market.question ?? "",
      ),
      outcomeLabel: market.groupItemTitle
        ? { default: market.groupItemTitle }
        : null,
    };
    this.markets.set(conditionId, ref);
    return ref;
  }

  private tokenFor(ref: MarketRef, outcome: Outcome): string {
    return outcome === "yes" ? ref.yesTokenId : ref.noTokenId;
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
      title: translationOf(position.questionTranslation, position.title ?? ""),
      // 持仓接口只给 outcome（Yes / No），没有多结果事件的选项名
      outcomeLabel: null,
      endsAt: position.endDate ?? null,
      outcome,
      shares: position.size,
      avgPriceCents: cents(position.avgPrice),
      curPriceCents: cents(position.curPrice),
      value: usdw(position.currentValue),
      costBasis: usdw(position.initialValue),
      pnl: usdw(position.cashPnl),
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
    const amount = usdw(inflow ? item.usdcSize : -item.usdcSize);
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

  private mapOrder(order: ClobOpenOrder, ref: MarketRef): Order {
    const type = (order.order_type ?? "").toUpperCase();
    const createdAt =
      typeof order.created_at === "number"
        ? iso(order.created_at)
        : (order.created_at ?? new Date(0).toISOString());
    const expiration = Number(order.expiration ?? 0);
    return {
      id: order.id,
      marketId: order.market,
      eventId: ref.eventId,
      title: ref.question,
      outcomeLabel: ref.outcomeLabel,
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

  private mapBook(
    marketId: string,
    book: ClobOrderBook,
    fallbackMinOrderShares = 1,
  ): OrderBook {
    const updatedAt = bookTimestamp(book.timestamp);
    const level = (item: { price: number; size: number }) => ({
      priceCents: cents(item.price),
      shares: item.size,
    });
    return {
      marketId,
      bids: book.bids.map(level),
      asks: book.asks.map(level),
      tickCents: (book.tick_size ?? 0.01) * 100,
      // marketdata.go:65 默认 "1"；WS 簿事件不带这个字段，用 gamma 的 orderMinSize 兜住
      minOrderShares: book.min_order_size ?? fallbackMinOrderShares,
      updatedAt,
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
    return this.mapBook(
      marketId,
      await fetchOrderBook(service, ref.yesTokenId),
      ref.minOrderShares ?? 1,
    );
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
        : Math.floor((this.deps.now?.() ?? Date.now()) / 1000) - windowSeconds;
    return points
      .filter((point) => point.t >= since)
      .map((point) => ({ t: iso(point.t), priceCents: cents(point.p) }));
  }

  /**
   * 行情推送：订阅每个市场 YES 代币的深度频道（level 2）。`book` → 整本簿，
   * `price_change` → 按买一卖一中间价换成 YES 价格（与列表展示价同一规则）。
   * 市场 → 代币的解析是异步的，取消函数在解析完成前后都有效。
   */
  subscribeMarkets(
    marketIds: string[],
    onEvent: (event: MarketEvent) => void,
  ): Unsubscribe {
    let cancelled = false;
    let stop: (() => void) | null = null;
    void (async () => {
      const service = await this.service();
      const refs = await Promise.all(marketIds.map((id) => this.marketRef(id)));
      if (cancelled) return;
      const byToken = new Map(refs.map((ref) => [ref.yesTokenId, ref]));
      // 平台关联（域名）变了就换连接；旧连接由剩余订阅者取消时自行断开
      const url = `${platformHosts(service.domain).clobWs}/ws/market`;
      if (!this.ws || this.wsUrl !== url) {
        this.ws = new MarketWsClient({
          url,
          createSocket: this.deps.createSocket,
        });
        this.wsUrl = url;
      }
      // 每个代币最近一次由簿算出的价；有簿价时忽略 last_trade_price（同网页版：成交价只是最后的回落）
      const bookPrice = new Map<string, number | null>();
      stop = this.ws.subscribe([...byToken.keys()], 2, (event) => {
        const ref = byToken.get(event.assetId);
        if (!ref) return;
        if (event.kind === "last_trade") {
          const last = tradable(event.price);
          if (last === null || (bookPrice.get(event.assetId) ?? null) !== null)
            return;
          onEvent({
            type: "price_change",
            marketId: ref.conditionId,
            yesPriceCents: cents(last),
          });
          return;
        }
        if (event.kind === "book") {
          const book = this.mapBook(
            ref.conditionId,
            {
              market: ref.conditionId,
              asset_id: event.assetId,
              bids: event.book.bids,
              asks: event.book.asks,
              tick_size: event.book.tick_size,
              timestamp: event.book.timestamp,
            },
            ref.minOrderShares ?? 1,
          );
          onEvent({ type: "book", book });
          // 网页版的概率来自订单簿；gamma 没缓存价时靠这一条把列表 / 详情的价格补上
          const fromBook = bookMidCents(book);
          bookPrice.set(event.assetId, fromBook);
          if (fromBook !== null)
            onEvent({
              type: "price_change",
              marketId: ref.conditionId,
              yesPriceCents: fromBook,
            });
          return;
        }
        const bid = tradable(event.bestBid);
        const ask = tradable(event.bestAsk);
        const mid =
          bid !== null && ask !== null
            ? (bid + ask) / 2
            : (ask ?? bid ?? tradable(event.price));
        if (mid === null) return;
        onEvent({
          type: "price_change",
          marketId: ref.conditionId,
          yesPriceCents: cents(mid),
        });
      });
    })().catch((error: unknown) =>
      console.warn("[predict] market subscription failed", error),
    );
    return () => {
      cancelled = true;
      stop?.();
    };
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
    const event = {
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

  // ---- 下单 ----

  /**
   * 把我们的下单请求换成平台口径：市价 = FAK、限价 = GTC / GTD；
   * 市价买价取买一（卖一）、市价卖价取卖一（买一）（`orderbookPricing.ts:28-31`）；
   * BUY 的 size 是 USDC 预算，SELL 的 size 是份数（`orderAmounts.ts`）。
   */
  private async draft(
    address: string,
    request: PlaceOrderRequest,
  ): Promise<{
    ctx: Awaited<ReturnType<HttpPredictAccountGateway["tradingContext"]>>;
    ref: MarketRef;
    tokenId: string;
    orderType: ClobOrderType;
    price: number;
    size: number;
    feeRateBps: number;
    tickSize: number | undefined;
    book: ClobOrderBook;
  }> {
    const ctx = await this.deps.account.tradingContext(address);
    const ref = await this.marketRef(request.marketId);
    const tokenId = this.tokenFor(ref, request.outcome);
    const orderType: ClobOrderType =
      request.type === "market" ? "FAK" : request.tif === "GTD" ? "GTD" : "GTC";
    const [book, feeRateBps, tickSize] = await Promise.all([
      fetchOrderBook(ctx.service, tokenId),
      fetchFeeRateBps(ctx.service, tokenId),
      orderType === "FAK" ? fetchTickSize(ctx.service, tokenId) : undefined,
    ]);
    let price: number;
    if (request.type === "market") {
      const best =
        request.side === "buy"
          ? book.asks.reduce<number | null>(
              (min, level) =>
                min === null || level.price < min ? level.price : min,
              null,
            )
          : book.bids.reduce<number | null>(
              (max, level) =>
                max === null || level.price > max ? level.price : max,
              null,
            );
      if (best === null)
        throw new Error(
          request.side === "buy"
            ? "no asks on the book to buy from"
            : "no bids on the book to sell into",
        );
      price = best;
    } else {
      if (!request.priceCents || request.priceCents <= 0)
        throw new Error("a limit order needs a price");
      price = request.priceCents / 100;
    }
    let size: number;
    if (request.side === "buy") {
      if (request.type === "market") {
        if (!request.amount) throw new Error("a market buy needs an amount");
        size = Number(request.amount.raw) / Number(ONE_USDC);
      } else {
        if (!request.shares || request.shares <= 0)
          throw new Error("a limit buy needs a share count");
        size = request.shares * price;
      }
    } else {
      if (!request.shares || request.shares <= 0)
        throw new Error("a sell needs a share count");
      size = request.shares;
    }
    return {
      ctx,
      ref,
      tokenId,
      orderType,
      price,
      size,
      feeRateBps,
      tickSize,
      book,
    };
  }

  async previewOrder(
    address: string,
    request: PlaceOrderRequest,
  ): Promise<OrderPreview> {
    const { book, feeRateBps, price, size } = await this.draft(
      address,
      request,
    );
    // 沿簿估算：市价单吃对手盘；限价单按限价（吃不到就是挂着，估算按挂单价）
    const filled =
      request.type === "market"
        ? request.side === "buy"
          ? walkBook(book.asks, { budgetUsdc: size })
          : walkBook(book.bids, { shares: size })
        : request.side === "buy"
          ? { shares: size / price, cost: size }
          : { shares: size, cost: size * price };
    const shares = Math.floor(filled.shares * 100) / 100;
    const cost = usdw(filled.cost);
    const fee = usdw((filled.cost * feeRateBps) / 10_000);
    const payout = usdw(shares);
    const costNumber = filled.cost;
    return {
      estimatedShares: shares,
      avgPriceCents: shares > 0 ? Math.round((filled.cost / shares) * 100) : 0,
      fee,
      cost,
      potentialPayout: payout,
      potentialReturnPct:
        costNumber > 0 ? ((shares - costNumber) / costNumber) * 100 : 0,
    };
  }

  async placeOrder(
    address: string,
    request: PlaceOrderRequest,
  ): Promise<OrderResult> {
    const { ctx, ref, tokenId, orderType, price, size, feeRateBps, tickSize } =
      await this.draft(address, request);
    const side = request.side === "buy" ? "BUY" : "SELL";
    const { makerAmount, takerAmount } = computeOrderAmounts({
      side,
      orderType,
      price,
      size,
      tickSize,
    });
    if (makerAmount <= 0n || takerAmount <= 0n)
      throw new Error("the order is too small for the market precision");
    const expirationSeconds =
      orderType === "GTD" && request.expiresAt
        ? Math.floor(new Date(request.expiresAt).getTime() / 1000)
        : 0;
    const signer = await this.deps.wallet.signerFor(address);
    const signed = await signOrder(
      {
        chainId: ctx.chainId,
        exchange: ref.negRisk
          ? ctx.contracts.negRiskExchange
          : ctx.contracts.ctfExchange,
        scopeId: ctx.service.scopeId,
        safe: ctx.safe,
        tokenId,
        side,
        makerAmount,
        takerAmount,
        feeRateBps,
        orderType,
        expirationSeconds,
      },
      signer,
      { reason: SIGN_REASON },
    );
    const response = await postOrder(
      ctx.service,
      { credentials: ctx.clob, address },
      signed,
      orderType,
    );
    // 平台按十进制返回成交量：takingAmount = Σ 抵押品、makingAmount = Σ 结果 token，与买卖方向无关
    // （match_dispatcher.go:1915-1921）。实测 prax1s 两个字段都等于份数，成交额拿不到就不编价。
    const making = Number(response.makingAmount ?? "0");
    const taking = Number(response.takingAmount ?? "0");
    const filledShares = making;
    const filledUsdc = taking !== making ? taking : null;
    const requestedShares =
      Number(side === "BUY" ? takerAmount : makerAmount) / Number(ONE_USDC);
    const status: OrderResult["status"] =
      response.status === "delayed"
        ? "delayed"
        : filledShares <= 0
          ? "open"
          : filledShares + 1e-6 >= requestedShares
            ? "filled"
            : "partial";
    return {
      orderId: response.orderID,
      status,
      filledShares,
      avgPriceCents:
        filledUsdc !== null && filledShares > 0
          ? Math.round((filledUsdc / filledShares) * 100)
          : null,
      fee:
        filledUsdc !== null ? usdw((filledUsdc * feeRateBps) / 10_000) : null,
      cost: filledUsdc !== null ? usdw(filledUsdc) : null,
    };
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
      result.push(this.mapOrder(order, ref));
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

  private recordTx(hash: string, kind: PredictTx["kind"]): PredictTx {
    // relayer 已等到 STATE_MINED / CONFIRMED，才拿得到 hash
    const tx: PredictTx = {
      id: hash,
      kind,
      status: "confirmed",
      hash,
      updatedAt: this.nowIso(),
    };
    this.txs.set(hash, tx);
    return tx;
  }

  /**
   * 领取已结算仓位：同一 conditionId 合并一条调用（`redeemBatch.ts:108-200`）。
   * 普通市场 `CTF.redeemPositions(USDW, 0x0, conditionId, indexSets)`，negRisk 市场
   * `NegRiskAdapter.redeemPositions(conditionId, [yes, no])`，金额取链上 ERC1155 余额；
   * 一笔 MultiSend 经 relayer 提交。
   */
  async redeem(address: string, positionIds: string[]): Promise<PredictTx> {
    const ctx = await this.deps.account.tradingContext(address);
    const chain = ctx.service.chain;
    type Group = {
      ref: MarketRef;
      indexSets: Set<bigint>;
      amounts: [bigint, bigint];
    };
    const groups = new Map<string, Group>();
    for (const id of positionIds) {
      const [conditionId, tokenId] = id.split(":");
      if (!conditionId || !tokenId)
        throw new Error(`position ${id} is not <conditionId>:<tokenId>`);
      const ref = await this.marketRef(conditionId);
      const outcome: Outcome =
        tokenId === ref.yesTokenId
          ? "yes"
          : tokenId === ref.noTokenId
            ? "no"
            : (() => {
                throw new Error(
                  `token ${tokenId} does not belong to ${conditionId}`,
                );
              })();
      const balance = decodeUint(
        await this.deps.onchain.readContract(
          chain,
          ctx.contracts.ctf,
          conditionalTokens.encodeFunctionData("balanceOf", [
            ctx.safe,
            BigInt(tokenId),
          ]),
        ),
      );
      if (balance <= 0n) continue;
      const group = groups.get(conditionId) ?? {
        ref,
        indexSets: new Set<bigint>(),
        amounts: [0n, 0n] as [bigint, bigint],
      };
      group.indexSets.add(outcome === "yes" ? 1n : 2n);
      group.amounts[outcome === "yes" ? 0 : 1] += balance;
      groups.set(conditionId, group);
    }
    if (groups.size === 0)
      throw new Error("none of the selected positions holds redeemable tokens");
    const ops = [...groups.values()].map((group) =>
      group.ref.negRisk
        ? {
            to: ctx.contracts.negRiskAdapter,
            data: negRiskAdapter.encodeFunctionData("redeemPositions", [
              group.ref.conditionId,
              group.amounts,
            ]),
          }
        : {
            to: ctx.contracts.ctf,
            data: conditionalTokens.encodeFunctionData("redeemPositions", [
              ctx.contracts.usdw,
              ZERO_BYTES32,
              group.ref.conditionId,
              [...group.indexSets].sort((a, b) => (a < b ? -1 : 1)),
            ]),
          },
    );
    const hash = await this.deps.account.relaySafe(address, {
      to: ctx.contracts.multiSend,
      data: encodeMultiSend(ops),
      operation: 1,
    });
    return this.recordTx(hash, "redeem");
  }

  /** 拆分 / 合并：直接调 CTF（negRisk 走 adapter），一笔 SafeTx（`useSplitMerge.ts:201-295`） */
  async splitOrMerge(
    address: string,
    marketId: string,
    direction: "split" | "merge",
    amount: Money,
  ): Promise<PredictTx> {
    const ctx = await this.deps.account.tradingContext(address);
    const ref = await this.marketRef(marketId);
    if (amount.decimals !== USDW_DECIMALS)
      throw new Error(
        `split / merge amount must be ${USDW_DECIMALS}-decimal USDW`,
      );
    const raw = BigInt(amount.raw);
    if (raw <= 0n) throw new Error("split / merge amount must be positive");
    const call = ref.negRisk
      ? {
          to: ctx.contracts.negRiskAdapter,
          data: negRiskAdapter.encodeFunctionData(
            direction === "split" ? "splitPosition" : "mergePositions",
            [ref.conditionId, raw],
          ),
        }
      : {
          to: ctx.contracts.ctf,
          data: conditionalTokens.encodeFunctionData(
            direction === "split" ? "splitPosition" : "mergePositions",
            [ctx.contracts.usdw, ZERO_BYTES32, ref.conditionId, [1n, 2n], raw],
          ),
        };
    const hash = await this.deps.account.relaySafe(address, {
      ...call,
      operation: 0,
    });
    return this.recordTx(hash, direction);
  }

  async submitDispute(): Promise<PredictTx> {
    throw new PredictUnsupportedError(
      "dispute",
      "the platform has no dispute submission for users",
    );
  }

  async getTx(id: string): Promise<PredictTx | null> {
    return this.txs.get(id) ?? null;
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
