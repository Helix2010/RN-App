import type { LocalizedText } from "../../../core/i18n/localized-text";
import type { Page, Unsubscribe } from "../../../core/gateways/types";
import { money, toBigInt, type Money } from "../../../core/money/money";
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
  decodeAddress,
  decodeUint,
  erc20,
  identifierForAdapter,
  lightOracle,
  negRiskAdapter,
  oracleAdapter,
  usdWrapper,
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
  fetchTrades,
  tradeTimestampMs,
  type PlatformTrade,
} from "../../../core/predict-platform/data-trades";
import {
  displayPrice,
  fetchCarouselTags,
  fetchEvent,
  fetchEvents,
  fetchMarketsByCondition,
  postDisputeEvidence,
  type GammaEvent,
  type GammaMarket,
  type GammaSeries,
  type GammaSeriesPeriod,
  type GammaTag,
  fetchCuratedEvents,
  fetchSeries,
  fetchSeriesList,
  fetchSeriesPeriods,
  tradablePrice,
  translationOf,
} from "../../../core/predict-platform/gamma";
import { fetchHolders } from "../../../core/predict-platform/data-holders";
import {
  alignBuyPriceToTick,
  computeOrderAmounts,
} from "../../../core/predict-platform/order-amounts";
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
import {
  PlatformHttpError,
  platformHosts,
} from "../../../core/predict-platform/tenant-client";
import { adapterAddressFor } from "../../../core/predict-platform/public-info";
import { CHAINS } from "../../../core/gateways/types";
import {
  PredictDisputeError,
  PredictInsufficientBondError,
  normalizeDisputeInput,
  validateDisputeInput,
} from "../model/dispute";
import type { WalletGateway } from "../../wallet/api/gateway";
import type { OnchainTransfers } from "../../wallet/api/onchain-transfers";
import type {
  Activity,
  ActivityType,
  Adjudication,
  CuratedEvent,
  EventQuery,
  HolderGroup,
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
  Series,
  SeriesPeriod,
  Tag,
  Trade,
  OrderBookLevel,
  DisputeInput,
  DisputeKey,
  DisputeStep,
  DisputeTerms,
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
 */

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

/**
 * 订单簿推出的 YES 概率（分）：mid → ask → bid，只认 0 < p < 100 的可成交价，
 * 同网页版 `orderbookPricing.ts` resolveFirstOptionProbability。
 */
/**
 * 市价买入的最小预算：平台要求 makerAmount ≥ 1 USDC（match_dispatcher.go validateOrderAmounts），
 * 而 FAK 买单的份数向下对齐 0.01 share 后 makerAmount = price × shares 往往略小于输入金额，
 * 输入正好 1.00 常被 400 拒掉。这里反推：先算 ≥ 1 USDC 所需的对齐份数，再把预算向上取到 0.01 USDC。
 */
function minMarketBuyUsdc(price: number, tickSize?: number): number {
  const priceInt = alignBuyPriceToTick(price, tickSize);
  const scale = 1_000_000n;
  const shareUnit = 10_000n;
  const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;
  const shares =
    ceilDiv(ceilDiv(ONE_USDC * scale, priceInt), shareUnit) * shareUnit;
  const maker = (priceInt * shares) / scale;
  return Number(ceilDiv(maker, shareUnit) * shareUnit) / Number(scale);
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
  // 平台阶段里的取消态（cancellation-pending / canceled）优先于其它推断
  if (adj?.currentPhase && /cancel/i.test(adj.currentPhase)) return "canceled";
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

/**
 * 区间 → clob `/price-history` 参数。fidelity（分钟）与网页版 `priceHistoryConfig.ts` 一致：
 * 1D 5 分钟、7D 30 分钟、1M 3 小时、ALL 12 小时；1h / 6h 是 App 多出来的两档，取 1D 数据再按窗口截。
 */
const HISTORY: Record<
  PriceRange,
  {
    interval: PriceHistoryInterval;
    fidelity: number;
    windowSeconds: number | null;
  }
> = {
  "1h": { interval: "1d", fidelity: 5, windowSeconds: 3_600 },
  "6h": { interval: "1d", fidelity: 5, windowSeconds: 6 * 3_600 },
  "1d": { interval: "1d", fidelity: 5, windowSeconds: null },
  "1w": { interval: "1w", fidelity: 30, windowSeconds: null },
  "1m": { interval: "1m", fidelity: 180, windowSeconds: null },
  all: { interval: "max", fidelity: 720, windowSeconds: null },
};
/** 历史点数 ≤ 1 时视为"没有聚合历史"，改用最近成交补点（网页版 `priceHistory.ts` loadSparseTradeFallback） */
const SPARSE_HISTORY_POINTS = 1;
const SPARSE_TRADES_LIMIT = 50;

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

function mapSeries(raw: GammaSeries): Series {
  return {
    id: raw.id,
    slug: raw.slug,
    title: translationOf(raw.titleTranslation, raw.title ?? raw.slug),
    recurrence: raw.recurrence ?? "",
    seriesType: raw.seriesType ?? "",
    active: raw.active ?? true,
    closed: raw.closed ?? false,
  };
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
      /** 仅供测试：等回执时的休眠 */
      sleep?: (ms: number) => Promise<void>;
      /** 仅供测试替换 WebSocket */
      createSocket?: (url: string) => SocketLike;
    },
  ) {}

  /** 本机刚提交、平台 indexer 还没追上的争议：marketId → 提交者与时间（乐观态） */
  private readonly optimisticDisputes = new Map<
    string,
    { by: string; at: string }
  >();

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
    const marketRules = (market.description ?? "").trim();
    return {
      id: market.conditionId,
      eventId: event.id,
      outcomeLabel,
      question,
      yesPriceCents: centsOrNull(displayPrice(market)),
      volumeUsd: market.volume ?? 0,
      volume24hUsd: market.volume24hr ?? 0,
      liquidityUsd: market.liquidity ?? 0,
      endsAt: market.endDate ?? event.endDate ?? "",
      closed: market.closed ?? event.closed ?? false,
      result: outcomeFromText(market.adjudication?.settledOutcome) ?? null,
      // 平台明确说不接单才禁用；字段缺失按可交易处理（与 user-dapp 一致）
      acceptingOrders: market.acceptingOrders !== false,
      // 市场级规则只在与事件规则不同时保留，避免详情页重复一段
      description:
        marketRules && marketRules !== (event.description ?? "").trim()
          ? { default: marketRules }
          : undefined,
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
      tags: tags.map((tag, index) => this.mapTag(tag, index)),
      markets,
      volumeUsd: multi
        ? rawMarkets.reduce((sum, market) => sum + (market.volume ?? 0), 0)
        : (primary?.volume ?? event.volume ?? 0),
      volume24hUsd:
        event.volume24hr ??
        rawMarkets.reduce((sum, market) => sum + (market.volume24hr ?? 0), 0),
      liquidityUsd:
        event.liquidity ??
        rawMarkets.reduce((sum, market) => sum + (market.liquidity ?? 0), 0),
      closed: event.closed ?? false,
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
      // 只有事件 slug 能打开事件页；持仓接口的 slug 是市场 slug，不能当事件用
      eventId: position.eventSlug ?? "",
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
      // 市场结算后 data-service 把 curPrice 换成结算价（positions.go:426-455）：赢 1 / 输 0
      settledPayoutCents: closed ? cents(position.curPrice) : undefined,
      // 还持有、且结算价 > 0 的仓位才有东西可领
      redeemable:
        (position.redeemable ?? false) &&
        position.size > 0 &&
        position.curPrice > 0,
      closed: position.size <= 0,
    };
  }

  private mapActivity(item: PlatformActivity, index: number): Activity | null {
    const type = ACTIVITY_TYPES[item.type.toUpperCase()];
    if (type === undefined) {
      // 平台新增的活动类型先跳过并留痕，不硬按成交显示
      console.warn(`[predict] unknown activity type ${item.type}`);
      return null;
    }
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

  private mapOrder(order: ClobOpenOrder, ref: MarketRef): Order | null {
    // 方向按 token id 对回市场，不信 outcome 文案（多语言 / 大小写都可能变）
    const outcome: Outcome | null =
      order.asset_id === ref.yesTokenId
        ? "yes"
        : order.asset_id === ref.noTokenId
          ? "no"
          : null;
    if (outcome === null) {
      console.warn(
        `[predict] order ${order.id} asset ${order.asset_id} is not a token of market ${order.market}`,
      );
      return null;
    }
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
      outcome,
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

  /**
   * 簿映射：档位按 tick 聚合（同价合并份数）、买盘从高到低、卖盘从低到高
   * （网页版 `adapters.ts` aggregateOrderBookLevelsByTick + pmOrderBookToSnapshot）。
   * 平台给的档位本就不保证有序，界面按"卖一 / 买一"取第一档，顺序必须在这里定下来。
   */
  private mapBook(
    marketId: string,
    book: ClobOrderBook,
    fallbackMinOrderShares = 1,
  ): OrderBook {
    const updatedAt = bookTimestamp(book.timestamp);
    const tickCents = (book.tick_size ?? 0.01) * 100;
    // 同价合并；价格保留到 0.1¢（簿的最细 tick），不再往粗 tick 上吸——平台已保证挂单对齐 tick
    const aggregate = (levels: { price: number; size: number }[]) => {
      const byPrice = new Map<number, number>();
      for (const item of levels) {
        if (!Number.isFinite(item.price) || !Number.isFinite(item.size))
          continue;
        const key = cents(item.price);
        byPrice.set(key, (byPrice.get(key) ?? 0) + item.size);
      }
      return [...byPrice.entries()]
        .filter(([, shares]) => shares > 0)
        .map(([priceCents, shares]): OrderBookLevel => ({
          priceCents,
          shares,
        }));
    };
    const last = tradablePrice(book.last_trade_price ?? null);
    return {
      marketId,
      bids: aggregate(book.bids).sort((a, b) => b.priceCents - a.priceCents),
      asks: aggregate(book.asks).sort((a, b) => a.priceCents - b.priceCents),
      tickCents,
      // marketdata.go:65 默认 "1"；WS 簿事件不带这个字段，用 gamma 的 orderMinSize 兜住
      minOrderShares: book.min_order_size ?? fallbackMinOrderShares,
      lastTradeCents: last === null ? null : cents(last),
      updatedAt,
    };
  }

  /** 成交映射：YES 视角的价格（NO 侧成交换算成 1 − p），时间戳认秒 / 毫秒 / ISO */
  private mapTrade(
    marketId: string,
    item: PlatformTrade,
    index: number,
  ): Trade | null {
    const ms = tradeTimestampMs(item.timestamp);
    if (ms === null) return null;
    const outcomeIndex = Number(item.outcomeIndex);
    const outcome: Outcome =
      outcomeIndex === 1
        ? "no"
        : outcomeIndex === 0
          ? "yes"
          : (item.outcome ?? "").toLowerCase() === "no"
            ? "no"
            : "yes";
    const yesPrice = outcome === "yes" ? item.price : 1 - item.price;
    return {
      id: `${item.transactionHash ?? item.id ?? ""}:${index}:${outcome}:${item.side ?? ""}`,
      marketId,
      outcome,
      side: (item.side ?? "").toUpperCase() === "SELL" ? "sell" : "buy",
      priceCents: cents(Math.min(Math.max(yesPrice, 0), 1)),
      shares: item.size,
      at: new Date(ms).toISOString(),
      hash: item.transactionHash ?? undefined,
    };
  }

  // ---- 公开行情 ----

  async listTags(): Promise<Tag[]> {
    const service = await this.service();
    const tags = await fetchCarouselTags(service);
    return tags.map((tag, index) => this.mapTag(tag, index));
  }

  async listEvents(query: EventQuery): Promise<Page<PredictEvent>> {
    const service = await this.service();
    const limit = query.limit ?? 20;
    const offset = query.cursor ? Number(query.cursor) : 0;
    const events = await fetchEvents(service, {
      tagId: query.tagId,
      status: query.status,
      order:
        query.sort === "endingSoon"
          ? "end_date_iso"
          : query.sort === "newest"
            ? "created_at"
            : query.sort === "volume24h"
              ? "volume24hr"
              : "volume",
      limit,
      offset,
    });
    const items = events.map((event) => this.mapEvent(event));
    // 平台没有流动性排序：按成交量取回当前页，再本地按流动性排
    if (query.sort === "liquidity")
      items.sort((a, b) => b.liquidityUsd - a.liquidityUsd);
    return {
      items,
      nextCursor: events.length === limit ? String(offset + limit) : null,
    };
  }

  async listCuratedEvents(): Promise<CuratedEvent[]> {
    const service = await this.service();
    const events = await fetchCuratedEvents(service);
    // featuredLevel 位掩码：normal=1 / highlight=2 / hero=4（HomepageCurationSection.tsx）
    const rank = (
      raw: GammaEvent,
      mask: number,
      order: number | null | undefined,
    ) =>
      ((raw.featuredLevel ?? 0) & mask) !== 0
        ? (order ?? raw.featuredOrder ?? Number.MAX_SAFE_INTEGER)
        : null;
    return events.map((raw) => ({
      event: this.mapEvent(raw),
      hero: rank(raw, 4, raw.featuredOrderHero),
      highlight: rank(raw, 2, raw.featuredOrderHighlight),
      normal: rank(raw, 1, raw.featuredOrderNormal),
    }));
  }

  async getHolders(marketId: string): Promise<HolderGroup[]> {
    const service = await this.service();
    const groups = await fetchHolders(service, marketId, 10);
    const byOutcome: Record<Outcome, HolderGroup> = {
      yes: { outcome: "yes", holders: [] },
      no: { outcome: "no", holders: [] },
    };
    for (const group of groups)
      for (const holder of group.holders) {
        const outcome: Outcome = holder.outcomeIndex === 1 ? "no" : "yes";
        byOutcome[outcome].holders.push({
          address: holder.proxyWallet,
          name:
            holder.displayUsernamePublic && holder.name
              ? holder.name
              : holder.pseudonym || null,
          shares: holder.amount,
        });
      }
    return [byOutcome.yes, byOutcome.no].map((group) => ({
      ...group,
      holders: group.holders.sort((a, b) => b.shares - a.shares),
    }));
  }

  async listSeries(): Promise<Series[]> {
    const service = await this.service();
    return (await fetchSeriesList(service)).map(mapSeries);
  }

  async getSeries(slug: string): Promise<Series> {
    const service = await this.service();
    return mapSeries(await fetchSeries(service, slug));
  }

  async listSeriesPeriods(
    seriesId: string,
    scope: "current" | "closed",
    limit = 12,
  ): Promise<SeriesPeriod[]> {
    const service = await this.service();
    const periods = await fetchSeriesPeriods(service, seriesId, {
      scope,
      limit,
    });
    return periods.map((raw) => this.mapSeriesPeriod(raw));
  }

  private mapSeriesPeriod(raw: GammaSeriesPeriod): SeriesPeriod {
    const event = raw.event ? this.mapEvent(raw.event) : undefined;
    return {
      id: raw.id,
      seriesId: raw.seriesId,
      eventId: raw.eventId,
      // 交易用 conditionId；平台 periods 里的 marketId 是 gamma 数字 id，只在没带事件时保留
      marketId: event?.markets[0]?.id ?? String(raw.marketId ?? ""),
      windowStart: raw.windowStart,
      windowEnd: raw.windowEnd,
      stage: raw.stage ?? "",
      priceToBeat: raw.priceToBeat
        ? {
            price: raw.priceToBeat.price,
            source: raw.priceToBeat.source ?? "",
            sampledAt: raw.priceToBeat.sampledAt ?? undefined,
          }
        : null,
      finalPrice: raw.finalPrice
        ? {
            price: raw.finalPrice.price,
            source: raw.finalPrice.source ?? "",
            sampledAt: raw.finalPrice.sampledAt ?? undefined,
          }
        : null,
      result: raw.result === "up" || raw.result === "down" ? raw.result : null,
      event,
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
    const { interval, fidelity, windowSeconds } = HISTORY[range];
    const points = await fetchPriceHistory(service, {
      tokenId: ref.yesTokenId,
      interval,
      fidelity,
    });
    const nowSeconds = Math.floor((this.deps.now?.() ?? Date.now()) / 1000);
    const since =
      windowSeconds === null
        ? interval === "1d"
          ? nowSeconds - 86_400
          : interval === "1w"
            ? nowSeconds - 7 * 86_400
            : interval === "1m"
              ? nowSeconds - 30 * 86_400
              : 0
        : nowSeconds - windowSeconds;
    const history = points
      .filter((point) => point.t >= since)
      .map((point) => ({ t: iso(point.t), priceCents: cents(point.p) }));
    if (history.length > SPARSE_HISTORY_POINTS) return history;
    // 聚合历史还没攒出来（新市场 / 低活跃）：按最近成交画线，与网页版一致；
    // 成交也没有就返回聚合给的那几个点（可能为空），界面显示"暂无走势"
    const trades = (await this.listTrades(marketId, SPARSE_TRADES_LIMIT))
      .filter((trade) => new Date(trade.at).getTime() / 1000 >= since)
      .sort((a, b) => a.at.localeCompare(b.at));
    const byTime = new Map<string, number>();
    for (const trade of trades) byTime.set(trade.at, trade.priceCents);
    const fromTrades = [...byTime.entries()].map(([t, priceCents]) => ({
      t,
      priceCents,
    }));
    return fromTrades.length > history.length ? fromTrades : history;
  }

  async listTrades(marketId: string, limit = 50): Promise<Trade[]> {
    const service = await this.service();
    const ref = await this.marketRef(marketId);
    const raw = await fetchTrades(service, ref.conditionId, limit);
    return raw
      .flatMap((item, index) => {
        const trade = this.mapTrade(ref.conditionId, item, index);
        return trade ? [trade] : [];
      })
      .sort((a, b) => b.at.localeCompare(a.at));
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
      const url = `${platformHosts(service).clobWs}/ws/market`;
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
          const last = tradablePrice(event.price);
          if (last === null) return;
          onEvent({
            type: "last_trade",
            marketId: ref.conditionId,
            priceCents: cents(last),
          });
          // 有簿价时展示价以簿为准（同网页版：成交价只是最后的回落）
          if ((bookPrice.get(event.assetId) ?? null) !== null) return;
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
              last_trade_price: event.book.last_trade_price,
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
        const bid = tradablePrice(event.bestBid);
        const ask = tradablePrice(event.bestAsk);
        const mid =
          bid !== null && ask !== null
            ? (bid + ask) / 2
            : (ask ?? bid ?? tradablePrice(event.price));
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
    const adapter = adj?.adapterInstance ?? undefined;
    const phase = adj?.currentPhase ?? undefined;
    // 链上争议的键：适配器地址（requester）+ identifier + 平台拼好的 requestTimestamp / ancillaryData
    let disputeKey: DisputeKey | undefined;
    if (
      adj?.ancillaryData &&
      adj.requestTimestamp !== null &&
      adj.requestTimestamp !== undefined &&
      adapter !== "crypto_periodic"
    ) {
      try {
        const { contracts } = await this.deps.account.platformContext();
        disputeKey = {
          requester: adapterAddressFor(contracts, adapter),
          identifier: identifierForAdapter(adapter),
          requestTimestamp: String(adj.requestTimestamp),
          ancillaryData: adj.ancillaryData,
        };
      } catch (error) {
        // 平台 public-info 没给这个适配器：这类市场在本租户不能争议，界面不显示入口
        console.warn("[predict] dispute adapter unavailable", error);
      }
    }
    // 乐观态：本机刚提交的争议，在平台 indexer 追上（返回 challenger）之前按已争议显示
    if (adj?.challenger) this.optimisticDisputes.delete(marketId);
    const optimistic = adj?.challenger
      ? undefined
      : this.optimisticDisputes.get(marketId);
    const disputedBy = adj?.challenger ?? optimistic?.by;
    let status = marketStatusOf(market, event);
    if (optimistic && status === "result_proposed") status = "disputed";
    return {
      marketId,
      status,
      endsAt: market.endDate ?? "",
      proposedOutcome: outcomeFromText(adj?.proposedOutcome),
      proposedAt: adj?.proposedAt ?? undefined,
      disputeDeadline: adj?.livenessDeadline ?? undefined,
      disputeWindowSec: adj?.livenessSecs ?? 0,
      // 以平台算好的阶段为准；crypto_periodic 没有争议环节；已有人争议就不能再提
      canDispute:
        phase === "liveness_period" &&
        adapter !== "crypto_periodic" &&
        !disputedBy &&
        disputeKey !== undefined,
      phase,
      adapter,
      disputeKey,
      disputedAt: adj?.challengedAt ?? optimistic?.at,
      disputedBy,
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
    const { book, feeRateBps, price, size, tickSize } = await this.draft(
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
    const grossShares = Math.floor(filled.shares * 100) / 100;
    // 均价用未截断的成交量算，否则截到 0.01 份会把 0.64 算成 0.6402
    const avgPrice = filled.shares > 0 ? filled.cost / filled.shares : null;
    // 平台手续费（plan.go calcExchangeFee）：bps × min(p, 1 − p) × 份数 / 1e4，
    // 买入从到手份额里扣、卖出从回款里扣；估算按平均成交价
    const feeUsdw =
      avgPrice === null
        ? 0
        : (grossShares * Math.min(avgPrice, 1 - avgPrice) * feeRateBps) /
          10_000;
    const netShares =
      request.side === "buy" && avgPrice
        ? Math.floor((grossShares - feeUsdw / avgPrice) * 100) / 100
        : grossShares;
    const costNumber = filled.cost;
    return {
      estimatedShares: netShares,
      avgPriceCents: avgPrice === null ? null : cents(avgPrice),
      fee: usdw(feeUsdw),
      cost: usdw(costNumber),
      // 买入：赢了每份兑 1 USDW；卖出：回款扣掉手续费
      potentialPayout: usdw(
        request.side === "buy" ? netShares : costNumber - feeUsdw,
      ),
      potentialReturnPct:
        request.side === "buy" && costNumber > 0
          ? ((netShares - costNumber) / costNumber) * 100
          : null,
      minAmount:
        request.type === "market" && request.side === "buy"
          ? usdw(minMarketBuyUsdc(price, tickSize))
          : null,
    };
  }

  async placeOrder(
    address: string,
    request: PlaceOrderRequest,
  ): Promise<OrderResult> {
    const {
      ctx,
      ref,
      tokenId,
      orderType,
      price,
      size,
      feeRateBps,
      tickSize,
      book,
    } = await this.draft(address, request);
    // 限价必须落在市场 tick 网格上且在 [tick, 1 − tick] 内，否则平台 400 ORDER_PRICE_NOT_ALIGNED；
    // tick 取 /book 的 tick_size（与订单簿页展示的同一来源），簿没给就交给平台校验（拒单原因会原样透出）
    const bookTick = book.tick_size;
    if (request.type === "limit" && typeof bookTick === "number") {
      const units = price / bookTick;
      if (
        price < bookTick ||
        price > 1 - bookTick ||
        Math.abs(units - Math.round(units)) > 1e-6
      )
        throw new Error(
          `limit price ${price} must be a multiple of the market tick ${bookTick} within [${bookTick}, ${1 - bookTick}]`,
        );
    }
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
    // 平台市价买下限 makerAmount ≥ 1 USDC：份数对齐后略低于 1 也会被 400，先在本地说清楚要多少
    if (side === "BUY" && orderType === "FAK" && makerAmount < ONE_USDC)
      throw new Error(
        `market buys need at least ${minMarketBuyUsdc(price, tickSize)} USDW at the current price`,
      );
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
    // 平台按十进制返回成交量，但 matcher.go 把 CollateralAmount 与 OutcomeAmount 都写成 fillAmount（份数），
    // 应答里拿不到成交额，所以只报份数，不编均价 / 手续费 / 成本（记在设计文档 §5 平台侧隐患）
    const filledShares = Number(response.makingAmount ?? "0");
    const requestedShares =
      Number(side === "BUY" ? takerAmount : makerAmount) / Number(ONE_USDC);
    // 平台应答 status：matched / live（挂着）/ canceled（FAK 零成交已撤）/ delayed（maker last-look 窗口）
    const status: OrderResult["status"] =
      response.status === "delayed"
        ? "delayed"
        : response.status === "canceled"
          ? "canceled"
          : filledShares <= 0
            ? "open"
            : filledShares + 1e-6 >= requestedShares
              ? "filled"
              : "partial";
    return {
      orderId: response.orderID,
      status,
      filledShares,
      avgPriceCents: null,
      fee: null,
      cost: null,
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
      const mapped = this.mapOrder(order, ref);
      if (mapped) result.push(mapped);
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
    return items.flatMap((item, index) => {
      const activity = this.mapActivity(item, index);
      return activity ? [activity] : [];
    });
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

  // ---- 争议（review-2026-09-05 §4.3；EOA 付 gas，对齐网页 RaiseDisputeModal）----

  /**
   * 读争议上下文：adapter.optimisticOracle() → LightOracle.getRequest(...) 拿押金与到期，
   * 再读本地址（EOA）的 USDW / USDC / 原生币余额。不用 adapter.getQuestion（网页注释里的两个坑）。
   */
  private async disputeContext(address: string, marketId: string) {
    const adj = await this.getAdjudication(marketId);
    if (adj.adapter === "crypto_periodic")
      throw new PredictDisputeError("unsupported_adapter", adj.adapter);
    if (!adj.disputeKey) throw new PredictDisputeError("no_dispute_key");
    const { service, contracts } = await this.deps.account.platformContext();
    const chain = service.chain;
    const key = adj.disputeKey;
    const oracle = decodeAddress(
      await this.deps.onchain.readContract(
        chain,
        key.requester,
        oracleAdapter.encodeFunctionData("optimisticOracle", []),
      ),
    );
    const [request] = lightOracle.decodeFunctionResult(
      "getRequest",
      await this.deps.onchain.readContract(
        chain,
        oracle,
        lightOracle.encodeFunctionData("getRequest", [
          key.requester,
          key.identifier,
          BigInt(key.requestTimestamp),
          key.ancillaryData,
        ]),
      ),
    );
    const bond = BigInt(request.requestSettings.bond);
    const expiration = Number(request.expirationTime);
    const [usdwRaw, usdcRaw, native] = await Promise.all([
      this.deps.onchain.readContract(
        chain,
        contracts.usdw,
        erc20.encodeFunctionData("balanceOf", [address]),
      ),
      this.deps.onchain.readContract(
        chain,
        contracts.usdcUnderlying,
        erc20.encodeFunctionData("balanceOf", [address]),
      ),
      this.deps.onchain.nativeBalance(chain, address),
    ]);
    const terms: DisputeTerms = {
      bond: money(bond, contracts.usdwDecimals, "USDW"),
      expiresAt: new Date(expiration * 1_000).toISOString(),
      oracle,
      usdwBalance: money(decodeUint(usdwRaw), contracts.usdwDecimals, "USDW"),
      usdcBalance: money(decodeUint(usdcRaw), contracts.usdcDecimals, "USDC"),
      nativeBalance: money(
        native,
        CHAINS[chain].nativeDecimals,
        CHAINS[chain].nativeSymbol,
      ),
    };
    return { adj, key, terms, service, contracts, chain, oracle, bond };
  }

  async getDisputeTerms(
    address: string,
    marketId: string,
  ): Promise<DisputeTerms> {
    return (await this.disputeContext(address, marketId)).terms;
  }

  async submitDispute(
    address: string,
    marketId: string,
    input: DisputeInput,
    onStep?: (step: DisputeStep) => void,
  ): Promise<PredictTx> {
    const normalized = normalizeDisputeInput(input);
    if (!validateDisputeInput(normalized).ok)
      throw new PredictDisputeError("evidence_rejected", "client validation");
    const { adj, key, terms, service, contracts, chain, oracle, bond } =
      await this.disputeContext(address, marketId);
    if (!adj.canDispute)
      throw new PredictDisputeError(
        adj.disputedBy ? "already_disputed" : "not_open",
        adj.phase ?? "",
      );
    // 1/4 证据意向：链上争议之前登记；平台 4xx 映射为可预期失败
    onStep?.("evidence");
    try {
      await postDisputeEvidence(service, {
        conditionId: marketId,
        disputer: address,
        evidence: normalized.evidence,
        links: normalized.links,
      });
    } catch (error) {
      if (error instanceof PlatformHttpError) {
        if (error.status === 404)
          throw new PredictDisputeError("unknown_market", error.message);
        if (error.status === 409)
          throw new PredictDisputeError(
            /already/i.test(error.message) ? "already_disputed" : "not_open",
            error.message,
          );
        if (error.status === 400)
          throw new PredictDisputeError("evidence_rejected", error.message);
      }
      throw error;
    }
    // 2/4 押金：从 EOA 的 USDW 扣，不够就停在这里（面板给兑换入口）
    onStep?.("bond");
    if (toBigInt(terms.usdwBalance) < bond)
      throw new PredictInsufficientBondError(terms.bond, terms.usdwBalance);
    const signer = await this.deps.wallet.signerFor(address);
    // 3/4 授权：按本次押金授权，不给无上限额度
    const allowance = decodeUint(
      await this.deps.onchain.readContract(
        chain,
        contracts.usdw,
        erc20.encodeFunctionData("allowance", [address, oracle]),
      ),
    );
    if (allowance < bond) {
      onStep?.("approve");
      const { hash } = await this.deps.onchain.callContract(
        chain,
        {
          from: address,
          to: contracts.usdw,
          data: erc20.encodeFunctionData("approve", [oracle, bond]),
          label: "approve USDW",
        },
        signer,
      );
      await this.waitReceipt(chain, hash, "approve USDW");
    }
    // 广播前再核一次到期：证据与授权可能花了几十秒，过期的 disputePrice 会 revert 白付 gas
    if (this.nowMs() >= new Date(terms.expiresAt).getTime())
      throw new PredictDisputeError("window_closed", terms.expiresAt);
    // 4/4 链上争议
    onStep?.("dispute");
    const { hash } = await this.deps.onchain.callContract(
      chain,
      {
        from: address,
        to: oracle,
        data: lightOracle.encodeFunctionData("disputePrice", [
          key.requester,
          key.identifier,
          BigInt(key.requestTimestamp),
          key.ancillaryData,
        ]),
        label: "disputePrice",
      },
      signer,
    );
    await this.waitReceipt(chain, hash, "disputePrice");
    this.optimisticDisputes.set(marketId, { by: address, at: this.nowIso() });
    return this.recordTx(hash, "dispute");
  }

  async wrapForDispute(
    address: string,
    amount: Money,
    onStep?: (step: "approve" | "wrap") => void,
  ): Promise<PredictTx> {
    const { service, contracts } = await this.deps.account.platformContext();
    const chain = service.chain;
    const raw = BigInt(amount.raw);
    if (raw <= 0n) throw new Error("wrap amount must be positive");
    const signer = await this.deps.wallet.signerFor(address);
    onStep?.("approve");
    const approve = await this.deps.onchain.callContract(
      chain,
      {
        from: address,
        to: contracts.usdcUnderlying,
        data: erc20.encodeFunctionData("approve", [contracts.usdwWrapper, raw]),
        label: "approve USDC",
      },
      signer,
    );
    await this.waitReceipt(chain, approve.hash, "approve USDC");
    onStep?.("wrap");
    // 与转入唯一的区别：USDW 收款人是 EOA 自己，不是 Safe
    const wrap = await this.deps.onchain.callContract(
      chain,
      {
        from: address,
        to: contracts.usdwWrapper,
        data: usdWrapper.encodeFunctionData("wrap", [
          contracts.usdcUnderlying,
          raw,
          address,
        ]),
        label: "wrap USDC",
      },
      signer,
    );
    await this.waitReceipt(chain, wrap.hash, "wrap USDC");
    return this.recordTx(wrap.hash, "deposit");
  }

  private nowMs(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** 等回执：中间步骤（授权）不等上链，下一步会因额度未生效而 revert；回执失败按失败。 */
  private async waitReceipt(
    chain: PredictServiceConfig["chain"],
    hash: string,
    label: string,
  ): Promise<void> {
    const sleep =
      this.deps.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const receipt = await this.deps.onchain.receiptOf(chain, hash);
      if (receipt) {
        if (receipt.status === "reverted")
          throw new PredictDisputeError("reverted", `${label} ${hash}`);
        return;
      }
      await sleep(2_000);
    }
    throw new Error(`${label} ${hash} was not mined in time`);
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
