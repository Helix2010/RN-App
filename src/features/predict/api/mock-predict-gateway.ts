import {
  memoryStorage,
  nextId,
  type KeyValueStorage,
  type Page,
  type Unsubscribe,
} from "../../../core/gateways/types";
import { localized } from "../../../core/i18n/localized-text";
import {
  isEmptyMode,
  mockNow,
  mockNowIso,
  mockRandom,
  simulate,
  scheduleMock,
} from "../../../core/mock/mock-runtime";
import {
  add,
  fromDecimal,
  isNegative,
  money,
  scaleBps,
  scaleRatio,
  sub,
  toApproxNumber,
  toBigInt,
  zero,
  type Money,
} from "../../../core/money/money";
import { EVENTS, LEADERBOARD, SEED_POSITIONS, TAGS } from "../fixtures/events";
import type {
  Activity,
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
  PredictBalance,
  PredictEvent,
  PredictTx,
  PriceRange,
  PricePoint,
  Tag,
  Trade,
} from "../model/predict";
import type { PredictGateway } from "./gateway";

const USDW = { decimals: 6, symbol: "USDW" };
/** 演示费率 0.2%（真实平台按代币从 clob 读） */
const MOCK_FEE_BPS = 20;
const usdc = (text: string) => fromDecimal(text, USDW.decimals, USDW.symbol);
const BOND = usdc("50");
/** 交易截止后多久商户"提交结果"（Mock 加速：10 分钟） */
const PROPOSE_DELAY_MS = 10 * 60 * 1_000;

type StoredPosition = {
  id: string;
  marketId: string;
  outcome: Outcome;
  shares: number;
  avgPriceCents: number;
  redeemed: boolean;
};
type StoredAdjudication = {
  proposedOutcome?: Outcome;
  proposedAt?: string;
  disputedAt?: string;
  disputedBy?: string;
  settledOutcome?: Outcome;
  settledAt?: string;
};

type State = {
  prices: Record<string, number>;
  balances: Record<string, { available: string; locked: string }>;
  positions: Record<string, StoredPosition[]>;
  orders: Record<string, Order[]>;
  activity: Record<string, Activity[]>;
  adjudication: Record<string, StoredAdjudication>;
  txs: PredictTx[];
};

const KEY = "foundation.mock-state.predict.v1";

function sharesToMoney(shares: number, priceCents: number): Money {
  // shares * price / 100，shares 保留 2 位小数 → 用 bigint 有理数
  const sharesX100 = BigInt(Math.round(shares * 100));
  const one = usdc("1");
  return scaleRatio(
    one,
    sharesX100 * BigInt(Math.round(priceCents * 10)),
    100n * 1000n,
  );
}

function moneyToShares(amount: Money, priceCents: number): number {
  return Math.floor((toApproxNumber(amount) * 100 * 100) / priceCents) / 100;
}

export class MockPredictGateway implements PredictGateway {
  private state: State | null = null;
  private loading: Promise<State> | null = null;
  private listeners = new Set<{
    marketIds: Set<string>;
    onEvent: (event: MarketEvent) => void;
  }>();
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly storage: KeyValueStorage = memoryStorage()) {}

  // ---------- 状态 ----------
  private async load(): Promise<State> {
    if (this.state) return this.state;
    if (!this.loading) {
      this.loading = (async () => {
        const raw = await this.storage.getItem(KEY);
        if (raw) {
          try {
            this.state = JSON.parse(raw) as State;
            return this.state;
          } catch {
            /* rebuild */
          }
        }
        this.state = {
          prices: Object.fromEntries(
            EVENTS.flatMap((event) =>
              event.markets.flatMap((m) =>
                m.yesPriceCents === null
                  ? []
                  : [[m.id, m.yesPriceCents] as const],
              ),
            ),
          ),
          balances: {},
          positions: {},
          orders: {},
          activity: {},
          adjudication: {
            "m-cpi-jul": {
              proposedOutcome: "yes",
              proposedAt: "2026-08-12T14:10:00Z",
              settledOutcome: "yes",
              settledAt: "2026-08-13T14:10:00Z",
            },
            "m-mun-liv": {
              proposedOutcome: "yes",
              proposedAt: "2026-08-29T18:00:00Z",
              disputedAt: "2026-08-29T18:02:00Z",
              disputedBy: "0x7c2e…41b9",
            },
          },
          txs: [],
        };
        return this.state;
      })();
    }
    return this.loading;
  }

  private async save(): Promise<void> {
    if (this.state) await this.storage.setItem(KEY, JSON.stringify(this.state));
  }

  /** 首次访问某地址时植入演示持仓与余额。 */
  private ensureAccount(state: State, address: string): void {
    if (state.balances[address]) return;
    state.balances[address] = {
      available: usdc("1240.50").raw,
      locked: usdc("320").raw,
    };
    state.positions[address] = SEED_POSITIONS.map((seed) => ({
      id: nextId("pos"),
      ...seed,
      redeemed: false,
    }));
    state.orders[address] = [
      {
        id: nextId("ord"),
        marketId: "m-btc-120k",
        title: this.market("m-btc-120k").market.question,
        outcomeLabel: this.market("m-btc-120k").market.outcomeLabel ?? null,
        eventId: "ev-btc-120k",
        outcome: "yes",
        side: "buy",
        type: "limit",
        priceCents: 58,
        shares: 200,
        filledShares: 0,
        tif: "GTC",
        createdAt: "2026-08-29T10:12:00Z",
        status: "open",
      },
      {
        id: nextId("ord"),
        marketId: "m-fomc-25",
        title: this.market("m-fomc-25").market.question,
        outcomeLabel: this.market("m-fomc-25").market.outcomeLabel ?? null,
        eventId: "ev-fomc-sep",
        outcome: "yes",
        side: "buy",
        type: "limit",
        priceCents: 68,
        shares: 300,
        filledShares: 0,
        tif: "GTD",
        expiresAt: "2026-09-10T00:00:00Z",
        createdAt: "2026-08-28T09:40:00Z",
        status: "open",
      },
    ];
    state.activity[address] = [
      {
        id: nextId("act"),
        type: "DEPOSIT",
        title: localized("从钱包存入", "Deposit from wallet"),
        amount: usdc("500"),
        at: "2026-08-30T03:40:00Z",
      },
      {
        id: nextId("act"),
        type: "TRADE",
        marketId: "m-btc-120k",
        eventId: "ev-btc-120k",
        title: localized("买入 Yes · 100 份", "Buy Yes · 100 shares"),
        amount: money((-toBigInt(usdc("62.20"))).toString(), 6, "USDW"),
        detail: localized("含费 0.20", "incl. fee 0.20"),
        at: "2026-08-30T03:42:00Z",
      },
      {
        id: nextId("act"),
        type: "SPLIT",
        marketId: "m-eth-etf",
        eventId: "ev-eth-etf",
        title: localized("拆分（Split）", "Split"),
        amount: money((-toBigInt(usdc("100"))).toString(), 6, "USDW"),
        detail: localized(
          "100 USDW → 100 Yes + 100 No",
          "100 USDW → 100 Yes + 100 No",
        ),
        at: "2026-08-29T12:15:00Z",
      },
      {
        id: nextId("act"),
        type: "DISPUTE_BOND",
        marketId: "m-mun-liv",
        eventId: "ev-mun-liv",
        title: localized("争议押金锁定", "Dispute bond locked"),
        amount: money((-toBigInt(BOND)).toString(), 6, "USDW"),
        detail: localized("裁决后返还", "Returned after ruling"),
        at: "2026-08-29T18:02:00Z",
      },
    ];
  }

  private market(marketId: string): { event: PredictEvent; market: Market } {
    for (const event of EVENTS) {
      const market = event.markets.find((item) => item.id === marketId);
      if (market) return { event, market };
    }
    throw new Error(`unknown market ${marketId}`);
  }

  private priceOf(state: State, marketId: string): number {
    const price =
      state.prices[marketId] ?? this.market(marketId).market.yesPriceCents;
    // 演示夹具的市场都带价；没有就是夹具写错了
    if (price === null)
      throw new Error(`fixture market ${marketId} has no price`);
    return price;
  }

  /** 结算状态机：截止 → 商户提交 → 争议期 → 自动结算；可被争议打断。 */
  private adjudicationOf(state: State, marketId: string): Adjudication {
    const { event, market } = this.market(marketId);
    // 用户动作（争议）持久化在 state.adjudication；截止 → 提案 → 自动结算 按当前时钟即时推导，不落盘，
    // 避免设备时钟异常把"已结算"写进存储。
    const persisted = state.adjudication[marketId] ?? {};
    const stored: StoredAdjudication = { ...persisted };
    const now = mockNow();
    const endsAtMs = new Date(market.endsAt).getTime();
    if (!stored.proposedAt && now >= endsAtMs + PROPOSE_DELAY_MS) {
      stored.proposedOutcome =
        this.priceOf(state, marketId) >= 50 ? "yes" : "no";
      stored.proposedAt = new Date(endsAtMs + PROPOSE_DELAY_MS).toISOString();
    }
    const disputeDeadline = stored.proposedAt
      ? new Date(
          new Date(stored.proposedAt).getTime() +
            event.disputeWindowSec * 1_000,
        ).toISOString()
      : undefined;
    if (
      stored.proposedAt &&
      !stored.disputedAt &&
      !stored.settledOutcome &&
      disputeDeadline &&
      now >= new Date(disputeDeadline).getTime()
    ) {
      stored.settledOutcome = stored.proposedOutcome;
      stored.settledAt = disputeDeadline;
    }
    let status: MarketStatus = "trading";
    if (stored.settledOutcome) status = "settled";
    else if (stored.disputedAt)
      status =
        now - new Date(stored.disputedAt).getTime() > 6 * 3_600_000
          ? "arbitrating"
          : "disputed";
    else if (stored.proposedAt) status = "result_proposed";
    else if (now >= endsAtMs) status = "awaiting_result";
    return {
      marketId,
      status,
      endsAt: market.endsAt,
      proposedOutcome: stored.proposedOutcome,
      proposedAt: stored.proposedAt,
      proposedEvidence: stored.proposedAt
        ? localized(
            "依据 Binance 收盘价 $121,480",
            "Based on Binance close $121,480",
          )
        : undefined,
      disputeDeadline,
      disputeWindowSec: event.disputeWindowSec,
      bond: BOND,
      canDispute: status === "result_proposed",
      disputedAt: stored.disputedAt,
      disputedBy: stored.disputedBy,
      settledOutcome: stored.settledOutcome,
      settledAt: stored.settledAt,
    };
  }

  private withLivePrices(state: State, event: PredictEvent): PredictEvent {
    return {
      ...event,
      markets: event.markets.map((market) => ({
        ...market,
        yesPriceCents: this.priceOf(state, market.id),
      })),
    };
  }

  private drift(state: State): void {
    for (const id of Object.keys(state.prices)) {
      if (mockRandom() < 0.35) {
        const delta = mockRandom() < 0.5 ? -1 : 1;
        state.prices[id] = Math.min(
          97,
          Math.max(3, (state.prices[id] ?? 50) + delta),
        );
      }
    }
  }

  // ---------- 公开只读 ----------
  async listTags(): Promise<Tag[]> {
    return simulate(() => (isEmptyMode() ? [] : TAGS));
  }

  async listEvents(query: EventQuery): Promise<Page<PredictEvent>> {
    return simulate(async () => {
      const state = await this.load();
      this.drift(state);
      if (isEmptyMode()) return { items: [], nextCursor: null };
      const now = mockNow();
      let items = EVENTS.filter(
        (event) =>
          new Date(event.endsAt).getTime() > now || query.tagId === undefined,
      );
      if (query.tagId && query.tagId !== "hot")
        items = items.filter(
          (event) =>
            event.tagIds.includes(query.tagId as string) ||
            event.categoryTagId === query.tagId,
        );
      if (query.tagId === "hot")
        items = items.filter(
          (event) => event.tagIds.includes("hot") || event.featured,
        );
      if (query.featured !== undefined)
        items = items.filter((event) => event.featured === query.featured);
      if (query.search) {
        const needle = query.search.toLowerCase();
        items = items.filter((event) =>
          Object.values(event.title).some((text) =>
            text?.toLowerCase().includes(needle),
          ),
        );
      }
      const sort = query.sort ?? "volume";
      items = [...items].sort((a, b) =>
        sort === "volume"
          ? b.volumeUsd - a.volumeUsd
          : sort === "endingSoon"
            ? new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime()
            : b.id.localeCompare(a.id),
      );
      const limit = query.limit ?? 20;
      const start = query.cursor ? Number(query.cursor) : 0;
      const slice = items
        .slice(start, start + limit)
        .map((event) => this.withLivePrices(state, event));
      return {
        items: slice,
        nextCursor: start + limit < items.length ? String(start + limit) : null,
      };
    });
  }

  async getEvent(slugOrId: string): Promise<PredictEvent> {
    return simulate(async () => {
      const state = await this.load();
      const event = EVENTS.find(
        (item) => item.slug === slugOrId || item.id === slugOrId,
      );
      if (!event) throw new Error(`event not found: ${slugOrId}`);
      return this.withLivePrices(state, event);
    });
  }

  async getOrderBook(marketId: string): Promise<OrderBook> {
    return simulate(async () => {
      const state = await this.load();
      const price = this.priceOf(state, marketId);
      const depth = [12_400, 8_120, 5_900, 4_050, 2_400];
      const bids = depth.map((shares, index) => ({
        priceCents: Math.max(
          1,
          price - index * (index < 2 ? 0.5 : 1) - (index >= 2 ? 0.5 : 0),
        ),
        shares,
      }));
      const asks = depth.map((shares, index) => ({
        priceCents: Math.min(99, price + 1 + index * (index < 2 ? 0.5 : 1)),
        shares: Math.round(shares * 0.78),
      }));
      return {
        marketId,
        bids,
        asks,
        tickCents: 0.5,
        minOrderShares: 1,
        lastTradeCents: price,
        updatedAt: mockNowIso(),
      };
    });
  }

  /** 演示成交：从 1h 走势里取最近的点，交替买卖 */
  async listTrades(marketId: string, limit = 50): Promise<Trade[]> {
    const history = await this.getPriceHistory(marketId, "1h");
    return history
      .slice(-limit)
      .reverse()
      .map((point, index) => ({
        id: `${marketId}:${point.t}`,
        marketId,
        outcome: "yes" as const,
        side: index % 3 === 0 ? ("sell" as const) : ("buy" as const),
        priceCents: point.priceCents,
        shares: 10 + ((index * 37) % 90),
        at: point.t,
      }));
  }

  async getPriceHistory(
    marketId: string,
    range: PriceRange,
  ): Promise<PricePoint[]> {
    return simulate(async () => {
      const state = await this.load();
      const points =
        range === "1h"
          ? 60
          : range === "6h"
            ? 72
            : range === "1d"
              ? 96
              : range === "1w"
                ? 84
                : 120;
      const stepMs =
        range === "1h"
          ? 60_000
          : range === "6h"
            ? 300_000
            : range === "1d"
              ? 900_000
              : range === "1w"
                ? 7_200_000
                : 21_600_000;
      const end = this.priceOf(state, marketId);
      let seed = marketId
        .split("")
        .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      const series: number[] = [end];
      for (let i = 1; i < points; i += 1) {
        seed = (seed * 9301 + 49297) % 233280;
        const rnd = seed / 233280;
        const prev = series[i - 1] ?? end;
        series.push(Math.min(97, Math.max(3, prev + (rnd - 0.5) * 3)));
      }
      series.reverse();
      const now = mockNow();
      return series.map((priceCents, index) => ({
        t: new Date(now - (points - 1 - index) * stepMs).toISOString(),
        priceCents: Math.round(priceCents * 10) / 10,
      }));
    });
  }

  subscribeMarkets(
    marketIds: string[],
    onEvent: (event: MarketEvent) => void,
  ): Unsubscribe {
    const listener = { marketIds: new Set(marketIds), onEvent };
    this.listeners.add(listener);
    if (!this.ticker) {
      this.ticker = setInterval(() => {
        void this.load().then((state) => {
          this.drift(state);
          for (const item of this.listeners) {
            for (const id of item.marketIds)
              item.onEvent({
                type: "price_change",
                marketId: id,
                yesPriceCents: this.priceOf(state, id),
              });
          }
        });
      }, 5_000);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.ticker) {
        clearInterval(this.ticker);
        this.ticker = null;
      }
    };
  }

  async getFeeBps(marketId: string): Promise<number> {
    return MOCK_FEE_BPS;
  }

  async getAdjudication(marketId: string): Promise<Adjudication> {
    return simulate(async () => {
      const state = await this.load();
      const result = this.adjudicationOf(state, marketId);
      await this.save();
      return result;
    });
  }

  // ---------- 账户 ----------
  /** 演示账本的余额：只供下单 / 撤单的演示逻辑与其测试用，不再是账户余额的来源。 */
  async getBalance(address: string): Promise<PredictBalance> {
    return simulate(async () => {
      const state = await this.load();
      this.ensureAccount(state, address);
      const balance = state.balances[address] as {
        available: string;
        locked: string;
      };
      const positions = await this.computePositions(state, address);
      const positionsValue = positions
        .filter((p) => p.status !== "settled")
        .reduce((sum, p) => add(sum, p.value), zero(6, "USDW"));
      const claimable = positions
        .filter((p) => p.redeemable)
        .reduce((sum, p) => add(sum, p.value), zero(6, "USDW"));
      await this.save();
      return {
        available: money(balance.available, 6, "USDW"),
        lockedInOrders: money(balance.locked, 6, "USDW"),
        positionsValue,
        claimable,
      };
    });
  }

  async previewOrder(
    address: string,
    request: PlaceOrderRequest,
  ): Promise<OrderPreview> {
    const state = await this.load();
    this.ensureAccount(state, address);
    this.market(request.marketId); // 未知市场直接抛错
    const yes = this.priceOf(state, request.marketId);
    const price =
      request.type === "limit" && request.priceCents
        ? request.priceCents
        : request.outcome === "yes"
          ? yes
          : 100 - yes;
    if (request.side === "buy") {
      const amount =
        request.type === "market"
          ? (request.amount ?? zero(6, "USDW"))
          : sharesToMoney(request.shares ?? 0, price);
      const fee = scaleBps(amount, MOCK_FEE_BPS);
      const net = sub(amount, fee);
      const shares =
        request.type === "market"
          ? moneyToShares(net, price)
          : (request.shares ?? 0);
      const payout = sharesToMoney(shares, 100);
      const cost = toApproxNumber(amount);
      return {
        estimatedShares: shares,
        minAmount: null,
        avgPriceCents: price,
        fee,
        cost: amount,
        potentialPayout: payout,
        potentialReturnPct:
          cost > 0 ? ((toApproxNumber(payout) - cost) / cost) * 100 : 0,
      };
    }
    const shares = request.shares ?? 0;
    const proceeds = sharesToMoney(shares, price);
    const fee = scaleBps(proceeds, MOCK_FEE_BPS);
    return {
      estimatedShares: shares,
      avgPriceCents: price,
      fee,
      cost: sub(proceeds, fee),
      potentialPayout: sub(proceeds, fee),
      potentialReturnPct: 0,
      minAmount: null,
    };
  }

  async placeOrder(
    address: string,
    request: PlaceOrderRequest,
  ): Promise<OrderResult> {
    return simulate(async () => {
      const state = await this.load();
      this.ensureAccount(state, address);
      const { event, market } = this.market(request.marketId);
      if (this.adjudicationOf(state, request.marketId).status !== "trading")
        throw new Error("market closed");
      const balance = state.balances[address] as {
        available: string;
        locked: string;
      };
      const positions = state.positions[address] as StoredPosition[];
      const orders = state.orders[address] as Order[];
      const yes = this.priceOf(state, request.marketId);
      const marketPrice = request.outcome === "yes" ? yes : 100 - yes;
      const preview = await this.previewOrder(address, request);
      const now = mockNowIso();

      if (request.side === "buy") {
        const crosses =
          request.type === "market" || (request.priceCents ?? 0) >= marketPrice;
        if (request.type === "limit" && !crosses) {
          const lock = preview.cost;
          const available = sub(money(balance.available, 6, "USDW"), lock);
          if (isNegative(available)) throw new Error("insufficient balance");
          balance.available = available.raw;
          balance.locked = add(money(balance.locked, 6, "USDW"), lock).raw;
          const order: Order = {
            id: nextId("ord"),
            marketId: request.marketId,
            eventId: event.id,
            title: market.question,
            outcomeLabel: market.outcomeLabel ?? null,
            outcome: request.outcome,
            side: "buy",
            type: "limit",
            priceCents: request.priceCents ?? marketPrice,
            shares: request.shares ?? 0,
            filledShares: 0,
            tif: request.tif ?? "GTC",
            expiresAt: request.expiresAt,
            createdAt: now,
            status: "open",
          };
          orders.unshift(order);
          await this.save();
          return {
            orderId: order.id,
            status: "open",
            filledShares: 0,
            avgPriceCents: order.priceCents,
            fee: zero(6, "USDW"),
            cost: lock,
          };
        }
        const available = sub(
          money(balance.available, 6, "USDW"),
          preview.cost,
        );
        if (isNegative(available)) throw new Error("insufficient balance");
        balance.available = available.raw;
        const existing = positions.find(
          (p) =>
            p.marketId === request.marketId &&
            p.outcome === request.outcome &&
            !p.redeemed,
        );
        if (existing) {
          const totalShares = existing.shares + preview.estimatedShares;
          existing.avgPriceCents =
            Math.round(
              ((existing.shares * existing.avgPriceCents +
                preview.estimatedShares * marketPrice) /
                totalShares) *
                10,
            ) / 10;
          existing.shares = Math.round(totalShares * 100) / 100;
        } else {
          positions.push({
            id: nextId("pos"),
            marketId: request.marketId,
            outcome: request.outcome,
            shares: preview.estimatedShares,
            avgPriceCents: marketPrice,
            redeemed: false,
          });
        }
        (state.activity[address] as Activity[]).unshift({
          id: nextId("act"),
          type: "TRADE",
          marketId: request.marketId,
          eventId: event.id,
          title: localized(
            `买入 ${request.outcome === "yes" ? "Yes" : "No"} · ${preview.estimatedShares} 份`,
            `Buy ${request.outcome === "yes" ? "Yes" : "No"} · ${preview.estimatedShares} shares`,
          ),
          amount: money((-toBigInt(preview.cost)).toString(), 6, "USDW"),
          detail: localized(
            `含费 ${toApproxNumber(preview.fee).toFixed(2)}`,
            `incl. fee ${toApproxNumber(preview.fee).toFixed(2)}`,
          ),
          at: now,
        });
        // 成交推动价格
        state.prices[request.marketId] = Math.min(
          97,
          Math.max(3, yes + (request.outcome === "yes" ? 1 : -1)),
        );
        await this.save();
        return {
          orderId: nextId("ord"),
          status: "filled",
          filledShares: preview.estimatedShares,
          avgPriceCents: marketPrice,
          fee: preview.fee,
          cost: preview.cost,
        };
      }

      // 卖出
      const position = positions.find(
        (p) =>
          p.marketId === request.marketId &&
          p.outcome === request.outcome &&
          !p.redeemed,
      );
      if (!position || position.shares < (request.shares ?? 0))
        throw new Error("insufficient shares");
      position.shares =
        Math.round((position.shares - (request.shares ?? 0)) * 100) / 100;
      if (position.shares <= 0)
        state.positions[address] = positions.filter(
          (p) => p.id !== position.id,
        );
      balance.available = add(
        money(balance.available, 6, "USDW"),
        preview.cost,
      ).raw;
      (state.activity[address] as Activity[]).unshift({
        id: nextId("act"),
        type: "TRADE",
        marketId: request.marketId,
        eventId: event.id,
        title: localized(
          `卖出 ${request.outcome === "yes" ? "Yes" : "No"} · ${request.shares} 份`,
          `Sell ${request.outcome === "yes" ? "Yes" : "No"} · ${request.shares} shares`,
        ),
        amount: preview.cost,
        at: now,
      });
      state.prices[request.marketId] = Math.min(
        97,
        Math.max(3, yes + (request.outcome === "yes" ? -1 : 1)),
      );
      await this.save();
      return {
        orderId: nextId("ord"),
        status: "filled",
        filledShares: request.shares ?? 0,
        avgPriceCents: marketPrice,
        fee: preview.fee,
        cost: preview.cost,
      };
    });
  }

  async listOpenOrders(address: string, marketId?: string): Promise<Order[]> {
    return simulate(async () => {
      const state = await this.load();
      this.ensureAccount(state, address);
      return (state.orders[address] ?? []).filter(
        (order) =>
          order.status === "open" && (!marketId || order.marketId === marketId),
      );
    });
  }

  async cancelOrder(address: string, orderId: string): Promise<void> {
    return simulate(async () => {
      const state = await this.load();
      const order = (state.orders[address] ?? []).find(
        (item) => item.id === orderId,
      );
      if (!order || order.status !== "open") throw new Error("order not open");
      order.status = "cancelled";
      const lock = sharesToMoney(
        order.shares - order.filledShares,
        order.priceCents,
      );
      const balance = state.balances[address] as {
        available: string;
        locked: string;
      };
      balance.locked = sub(money(balance.locked, 6, "USDW"), lock).raw;
      balance.available = add(money(balance.available, 6, "USDW"), lock).raw;
      await this.save();
    });
  }

  private async computePositions(
    state: State,
    address: string,
  ): Promise<Position[]> {
    this.ensureAccount(state, address);
    return (state.positions[address] ?? []).map((stored) => {
      const { event, market } = this.market(stored.marketId);
      const adjudication = this.adjudicationOf(state, stored.marketId);
      const yes = this.priceOf(state, stored.marketId);
      let curPriceCents = stored.outcome === "yes" ? yes : 100 - yes;
      let settledPayoutCents: number | undefined;
      if (adjudication.status === "settled" && adjudication.settledOutcome) {
        settledPayoutCents =
          adjudication.settledOutcome === stored.outcome ? 100 : 0;
        curPriceCents = settledPayoutCents;
      }
      const value = stored.redeemed
        ? zero(6, "USDW")
        : sharesToMoney(stored.shares, curPriceCents);
      const costBasis = sharesToMoney(stored.shares, stored.avgPriceCents);
      const pnl = sub(value, costBasis);
      return {
        id: stored.id,
        marketId: stored.marketId,
        eventId: event.id,
        title: market.question,
        outcomeLabel: market.outcomeLabel ?? null,
        endsAt: event.endsAt,
        outcome: stored.outcome,
        shares: stored.shares,
        avgPriceCents: stored.avgPriceCents,
        curPriceCents,
        value,
        costBasis,
        pnl,
        pnlPct:
          toApproxNumber(costBasis) > 0
            ? (toApproxNumber(pnl) / toApproxNumber(costBasis)) * 100
            : 0,
        status: adjudication.status,
        redeemable:
          adjudication.status === "settled" &&
          !stored.redeemed &&
          settledPayoutCents === 100,
        settledPayoutCents,
        closed: stored.redeemed,
      };
    });
  }

  async listPositions(
    address: string,
    options?: { includeClosed?: boolean },
  ): Promise<Position[]> {
    return simulate(async () => {
      const state = await this.load();
      const positions = await this.computePositions(state, address);
      await this.save();
      const filtered = options?.includeClosed
        ? positions
        : positions.filter((p) => p.shares > 0 && !p.closed);
      const rank = (p: Position) =>
        p.redeemable
          ? 0
          : p.status === "disputed" || p.status === "arbitrating"
            ? 1
            : p.status === "settled"
              ? 3
              : 2;
      return filtered.sort(
        (a, b) =>
          rank(a) - rank(b) ||
          toApproxNumber(b.value) - toApproxNumber(a.value),
      );
    });
  }

  async listActivity(address: string): Promise<Activity[]> {
    return simulate(async () => {
      const state = await this.load();
      this.ensureAccount(state, address);
      return isEmptyMode() ? [] : [...(state.activity[address] ?? [])];
    });
  }

  async getPnl(address: string, range: PriceRange): Promise<PnlPoint[]> {
    return simulate(async () => {
      const state = await this.load();
      const positions = await this.computePositions(state, address);
      const total = positions.reduce(
        (sum, p) => sum + toApproxNumber(p.pnl),
        0,
      );
      const points = range === "1d" ? 24 : range === "1w" ? 7 * 4 : 30;
      const stepMs =
        range === "1d"
          ? 3_600_000
          : range === "1w"
            ? 6 * 3_600_000
            : 24 * 3_600_000;
      const now = mockNow();
      return Array.from({ length: points }, (_, index) => ({
        t: new Date(now - (points - 1 - index) * stepMs).toISOString(),
        pnlUsd:
          Math.round(total * (0.4 + (0.6 * index) / (points - 1)) * 100) / 100,
      }));
    });
  }

  private pushTx(state: State, kind: PredictTx["kind"]): PredictTx {
    const tx: PredictTx = {
      id: nextId("ptx"),
      kind,
      status: "submitted",
      updatedAt: mockNowIso(),
      hash: `0x${Math.floor(mockRandom() * 1e15)
        .toString(16)
        .padStart(14, "0")}${"1".repeat(50)}`,
    };
    state.txs.unshift(tx);
    scheduleMock(() => void this.advanceTx(tx.id, "confirming"), 1_200);
    scheduleMock(() => void this.advanceTx(tx.id, "confirmed"), 3_500);
    return tx;
  }

  private async advanceTx(
    id: string,
    status: PredictTx["status"],
  ): Promise<void> {
    const state = await this.load();
    const tx = state.txs.find((item) => item.id === id);
    if (!tx || tx.status === "confirmed" || tx.status === "failed") return;
    tx.status = status;
    tx.updatedAt = mockNowIso();
    await this.save();
  }

  async redeem(address: string, positionIds: string[]): Promise<PredictTx> {
    return simulate(async () => {
      const state = await this.load();
      const positions = await this.computePositions(state, address);
      const stored = state.positions[address] ?? [];
      let total = zero(6, "USDW");
      for (const position of positions) {
        if (!positionIds.includes(position.id) || !position.redeemable)
          continue;
        total = add(total, position.value);
        const record = stored.find((item) => item.id === position.id);
        if (record) record.redeemed = true;
        (state.activity[address] as Activity[]).unshift({
          id: nextId("act"),
          type: "REDEEM",
          marketId: position.marketId,
          eventId: position.eventId,
          title: localized("结算收益", "Settlement payout"),
          amount: position.value,
          at: mockNowIso(),
        });
      }
      if (toBigInt(total) === 0n) throw new Error("nothing to redeem");
      const balance = state.balances[address] as {
        available: string;
        locked: string;
      };
      balance.available = add(money(balance.available, 6, "USDW"), total).raw;
      const tx = this.pushTx(state, "redeem");
      await this.save();
      return tx;
    });
  }

  async splitOrMerge(
    address: string,
    marketId: string,
    direction: "split" | "merge",
    amount: Money,
  ): Promise<PredictTx> {
    return simulate(async () => {
      const state = await this.load();
      this.ensureAccount(state, address);
      const balance = state.balances[address] as {
        available: string;
        locked: string;
      };
      const positions = state.positions[address] as StoredPosition[];
      const shares = toApproxNumber(amount);
      const { event } = this.market(marketId);
      const adjust = (outcome: Outcome, delta: number) => {
        const existing = positions.find(
          (p) =>
            p.marketId === marketId && p.outcome === outcome && !p.redeemed,
        );
        if (existing) {
          existing.avgPriceCents =
            delta > 0
              ? Math.round(
                  ((existing.shares * existing.avgPriceCents + delta * 50) /
                    (existing.shares + delta)) *
                    10,
                ) / 10
              : existing.avgPriceCents;
          existing.shares = Math.round((existing.shares + delta) * 100) / 100;
          if (existing.shares < 0) throw new Error("insufficient shares");
        } else if (delta > 0)
          positions.push({
            id: nextId("pos"),
            marketId,
            outcome,
            shares: delta,
            avgPriceCents: 50,
            redeemed: false,
          });
        else throw new Error("insufficient shares");
      };
      if (direction === "split") {
        const available = sub(money(balance.available, 6, "USDW"), amount);
        if (isNegative(available)) throw new Error("insufficient balance");
        balance.available = available.raw;
        adjust("yes", shares);
        adjust("no", shares);
      } else {
        adjust("yes", -shares);
        adjust("no", -shares);
        balance.available = add(
          money(balance.available, 6, "USDW"),
          amount,
        ).raw;
      }
      state.positions[address] = positions.filter((p) => p.shares > 0);
      (state.activity[address] as Activity[]).unshift({
        id: nextId("act"),
        type: direction === "split" ? "SPLIT" : "MERGE",
        marketId,
        eventId: event.id,
        title:
          direction === "split"
            ? localized("拆分（Split）", "Split")
            : localized("合并（Merge）", "Merge"),
        amount:
          direction === "split"
            ? money((-toBigInt(amount)).toString(), 6, "USDW")
            : amount,
        detail: localized(
          `${shares} USDW ⇄ ${shares} Yes + ${shares} No`,
          `${shares} USDW ⇄ ${shares} Yes + ${shares} No`,
        ),
        at: mockNowIso(),
      });
      const tx = this.pushTx(state, direction);
      await this.save();
      return tx;
    });
  }

  async submitDispute(
    address: string,
    marketId: string,
    reason: string,
  ): Promise<PredictTx> {
    return simulate(async () => {
      const state = await this.load();
      this.ensureAccount(state, address);
      const adjudication = this.adjudicationOf(state, marketId);
      if (!adjudication.canDispute) throw new Error("dispute window closed");
      const balance = state.balances[address] as {
        available: string;
        locked: string;
      };
      const available = sub(money(balance.available, 6, "USDW"), BOND);
      if (isNegative(available))
        throw new Error("insufficient balance for bond");
      balance.available = available.raw;
      const stored: StoredAdjudication = {
        ...(state.adjudication[marketId] ?? {}),
        proposedOutcome: adjudication.proposedOutcome,
        proposedAt: adjudication.proposedAt,
        disputedAt: mockNowIso(),
        disputedBy: address,
      };
      state.adjudication[marketId] = stored;
      const { event } = this.market(marketId);
      (state.activity[address] as Activity[]).unshift({
        id: nextId("act"),
        type: "DISPUTE_BOND",
        marketId,
        eventId: event.id,
        title: localized("争议押金锁定", "Dispute bond locked"),
        amount: money((-toBigInt(BOND)).toString(), 6, "USDW"),
        detail: localized(
          reason || "裁决后返还",
          reason || "Returned after ruling",
        ),
        at: mockNowIso(),
      });
      const tx = this.pushTx(state, "dispute");
      await this.save();
      return tx;
    });
  }

  async getTx(id: string): Promise<PredictTx | null> {
    const state = await this.load();
    const tx = state.txs.find((item) => item.id === id);
    return tx ? { ...tx } : null;
  }

  async getLeaderboard(
    period: LeaderboardPeriod,
    sort: "pnl" | "volume",
  ): Promise<LeaderboardEntry[]> {
    return simulate(() => {
      const factor =
        period === "today"
          ? 0.12
          : period === "week"
            ? 1
            : period === "month"
              ? 3.4
              : 11;
      const rows = LEADERBOARD.map((row) => ({
        ...row,
        pnlUsd: Math.round(row.pnlUsd * factor),
        volumeUsd: Math.round(row.volumeUsd * factor),
      }));
      rows.sort((a, b) =>
        sort === "pnl" ? b.pnlUsd - a.pnlUsd : b.volumeUsd - a.volumeUsd,
      );
      return rows.map((row, index) => ({ ...row, rank: index + 1 }));
    });
  }
}
