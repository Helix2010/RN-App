import { z } from "zod";
import { bookLevelSchema } from "./clob-market";

/**
 * clob-ws 行情频道 `wss://clob-ws.{domain}/ws/market`，协议照 `wsservice/market_channel.go`
 * 与 user-dapp `lib/ws/polymarket.ts`：
 * - 订阅帧 `{assets_ids, type:"market", custom_feature_enabled:true, initial_dump:true, level}`：服务端把
 *   assets 并进已有订阅并给这些代币推初始 dump（`market_channel.go` `case sub.Type == "market"` 只增不清），
 *   所以新增代币也用它，而不用 `{operation:"subscribe"}`（那条不推初始簿）；退订 `{operation:"unsubscribe", assets_ids}`；
 *   level 1 = quote、2 = depth；
 * - 服务端每 10 秒 ping、15 秒等 pong（协议帧，RN 的 WebSocket 自动应答）；客户端另外每 10 秒发文本
 *   `PING`，服务端回文本 `PONG`；
 * - 事件：`book`（初始 dump 把簿放在 `data` 里，`timestamp` 是 ISO 串；实时事件平铺 bids / asks，形态同 REST `/book`）、
 *   `price_change`（`price_changes[{asset_id, price, size, side, best_bid, best_ask}]`，实测可能是空数组）、
 *   `last_trade_price`（`data.price`）、`tick_size_change` 等；未订阅 / 不认识的事件忽略；
 * - 断线按 1s → 30s 指数退避重连，重连后重发全部订阅（服务端会再发一次初始 dump）。
 */

const numeric = z.union([z.number(), z.string()]).transform((value) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
});

const bookPayloadSchema = z.object({
  asset_id: z.string(),
  bids: z.array(bookLevelSchema),
  asks: z.array(bookLevelSchema),
  tick_size: numeric.nullish(),
  timestamp: z.union([z.string(), z.number()]).nullish(),
});

const priceChangeSchema = z.object({
  event_type: z.literal("price_change"),
  price_changes: z.array(
    z.object({
      asset_id: z.string(),
      price: numeric,
      size: numeric,
      side: z.string(),
      best_bid: numeric.nullish(),
      best_ask: numeric.nullish(),
    }),
  ),
  timestamp: z.union([z.string(), z.number()]).nullish(),
});

const lastTradeSchema = z.object({
  event_type: z.literal("last_trade_price"),
  asset_id: z.string(),
  data: z.object({ price: numeric }),
});

type MarketWsBook = z.infer<typeof bookPayloadSchema>;
export type MarketWsEvent =
  | { kind: "book"; assetId: string; book: MarketWsBook }
  | {
      kind: "price_change";
      assetId: string;
      price: number | null;
      bestBid: number | null;
      bestAsk: number | null;
    }
  | { kind: "last_trade"; assetId: string; price: number | null };

type MarketWsLevel = 1 | 2;

/** 与浏览器 / RN 全局 `WebSocket` 相同的最小面 */
export type SocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

const OPEN = 1;
const PING_INTERVAL_MS = 10_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

type Listener = (event: MarketWsEvent) => void;

export class MarketWsClient {
  private socket: SocketLike | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly levels = new Map<string, MarketWsLevel>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  private closed = false;

  constructor(
    private readonly deps: {
      url: string;
      createSocket?: (url: string) => SocketLike;
    },
  ) {}

  /** 订阅一批代币；返回取消函数。没有人订阅时不建连接。 */
  subscribe(
    assetIds: string[],
    level: MarketWsLevel,
    listener: Listener,
  ): () => void {
    const fresh: string[] = [];
    for (const id of assetIds) {
      const set = this.listeners.get(id) ?? new Set<Listener>();
      if (set.size === 0) fresh.push(id);
      set.add(listener);
      this.listeners.set(id, set);
      // depth 覆盖 quote：任何一个订阅者要深度，这个代币就订深度
      const current = this.levels.get(id);
      if (current === undefined || level > current) this.levels.set(id, level);
    }
    this.closed = false;
    if (!this.socket) this.connect();
    else if (this.socket.readyState === OPEN && fresh.length > 0)
      // 新增代币也发 market 帧：服务端只增不清已有订阅，并立刻推这些代币的初始簿
      this.send({
        assets_ids: fresh,
        type: "market",
        custom_feature_enabled: true,
        initial_dump: true,
        level,
      });
    return () => {
      const gone: string[] = [];
      for (const id of assetIds) {
        const set = this.listeners.get(id);
        if (!set) continue;
        set.delete(listener);
        if (set.size === 0) {
          this.listeners.delete(id);
          this.levels.delete(id);
          gone.push(id);
        }
      }
      if (gone.length > 0 && this.socket?.readyState === OPEN)
        this.send({ operation: "unsubscribe", assets_ids: gone });
      if (this.listeners.size === 0) this.disconnect();
    };
  }

  private connect(): void {
    if (this.closed) return;
    const create =
      this.deps.createSocket ??
      ((url: string) => new WebSocket(url) as unknown as SocketLike);
    const socket = create(this.deps.url);
    this.socket = socket;
    socket.onopen = () => {
      this.reconnectDelay = RECONNECT_MIN_MS;
      this.sendInitialSubscription();
      this.startPing();
    };
    socket.onmessage = (event) => this.handleMessage(event.data);
    socket.onclose = () => {
      // 旧连接迟到的 close 不能动新连接的心跳，也不能触发重连
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopPing();
      if (!this.closed && this.listeners.size > 0) this.scheduleReconnect();
    };
    socket.onerror = () => socket.close();
  }

  private disconnect(): void {
    this.closed = true;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
      this.connect();
    }, this.reconnectDelay);
  }

  private sendInitialSubscription(): void {
    const byLevel = new Map<MarketWsLevel, string[]>();
    for (const [id, level] of this.levels) {
      const group = byLevel.get(level) ?? [];
      group.push(id);
      byLevel.set(level, group);
    }
    for (const level of [2, 1] as const) {
      const group = byLevel.get(level);
      if (!group || group.length === 0) continue;
      this.send({
        assets_ids: group,
        type: "market",
        custom_feature_enabled: true,
        initial_dump: true,
        level,
      });
    }
  }

  private send(frame: Record<string, unknown>): void {
    if (this.socket?.readyState !== OPEN) return;
    this.socket.send(JSON.stringify(frame));
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.socket?.readyState === OPEN) this.socket.send("PING");
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string" || data === "PONG") return;
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      return;
    }
    const items: unknown[] = Array.isArray(raw) ? raw : [raw];
    for (const item of items) this.dispatch(item);
  }

  private dispatch(item: unknown): void {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const type = record.event_type;
    if (type === "price_change") {
      const parsed = priceChangeSchema.safeParse(record);
      if (!parsed.success) return;
      for (const change of parsed.data.price_changes)
        this.emit(change.asset_id, {
          kind: "price_change",
          assetId: change.asset_id,
          price: change.price,
          bestBid: change.best_bid ?? null,
          bestAsk: change.best_ask ?? null,
        });
      return;
    }
    if (type === "last_trade_price") {
      const parsed = lastTradeSchema.safeParse(record);
      if (!parsed.success) return;
      this.emit(parsed.data.asset_id, {
        kind: "last_trade",
        assetId: parsed.data.asset_id,
        price: parsed.data.data.price,
      });
      return;
    }
    if (type === "book") {
      // 初始 dump 把簿放在 data 里；实时事件平铺（`polymarket.ts` normalizeMarketWsEvents）
      const nested =
        record.data &&
        typeof record.data === "object" &&
        !Array.isArray(record.data)
          ? (record.data as Record<string, unknown>)
          : {};
      const parsed = bookPayloadSchema.safeParse({ ...record, ...nested });
      if (!parsed.success) return;
      this.emit(parsed.data.asset_id, {
        kind: "book",
        assetId: parsed.data.asset_id,
        book: parsed.data,
      });
    }
  }

  private emit(assetId: string, event: MarketWsEvent): void {
    const set = this.listeners.get(assetId);
    if (!set) return;
    for (const listener of set) listener(event);
  }
}
