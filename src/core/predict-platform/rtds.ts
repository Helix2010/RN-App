import { z } from "zod";
import type { PredictServiceConfig } from "../config/bootstrap.schema";
import type { SocketLike } from "./market-ws";
import { platformHosts, platformRequest } from "./tenant-client";

/**
 * 实时数据服务 RTDS（`services/rtds-service`；网页版 `lib/api/rtds.ts` + `lib/ws/rtds.ts`）：
 * 周期市场的标的实时价、tick 历史、K 线，以及按周期 / 结算声明解析取价源。
 */

// ---- 标的解析（移植网页版 lib/markets/cryptoSeries.ts；认不出来返回 null，不兜底成 BTC）----

const KNOWN_ASSETS = [
  "btc",
  "eth",
  "sol",
  "xrp",
  "doge",
  "bnb",
  "ada",
  "ltc",
  "avax",
  "link",
  "dot",
  "matic",
] as const;
type KnownAsset = (typeof KNOWN_ASSETS)[number];
const ASSET_ALIASES: Record<string, KnownAsset> = {
  btc: "btc",
  bitcoin: "btc",
  eth: "eth",
  ether: "eth",
  ethereum: "eth",
  sol: "sol",
  solana: "sol",
  xrp: "xrp",
  ripple: "xrp",
  doge: "doge",
  dogecoin: "doge",
  bnb: "bnb",
  binance: "bnb",
  ada: "ada",
  cardano: "ada",
  ltc: "ltc",
  litecoin: "ltc",
  avax: "avax",
  avalanche: "avax",
  link: "link",
  chainlink: "link",
  dot: "dot",
  polkadot: "dot",
  matic: "matic",
  polygon: "matic",
};

function tickerSymbol(value: string | null | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const tokens = raw
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  for (const asset of KNOWN_ASSETS) {
    const upper = asset.toUpperCase();
    if (compact === `${upper}USD` || compact === `${upper}USDT`)
      return `${upper}USD`;
    for (let i = 0; i < tokens.length; i += 1)
      if (
        tokens[i] === upper &&
        (tokens[i + 1] === "USD" || tokens[i + 1] === "USDT")
      )
        return `${upper}USD`;
  }
  return null;
}

/** ticker → slug / 标题的 `BTC USD` 写法 → 别名（btc / bitcoin…）；都认不出来返回 null */
export function resolveCryptoSymbol(series: {
  ticker: string | null;
  slug: string;
  title?: string | null;
}): string | null {
  const byTicker = tickerSymbol(series.ticker);
  if (byTicker) return byTicker;
  const text = [series.slug, series.title ?? ""].join(" ");
  const direct = tickerSymbol(text);
  if (direct) return direct;
  for (const token of text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)) {
    const asset = ASSET_ALIASES[token];
    if (asset) return `${asset.toUpperCase()}USD`;
  }
  return null;
}

// ---- REST ----

const num = z.union([z.number(), z.string()]).transform(Number);
const tickMessageSchema = z.object({
  topic: z.string().nullish(),
  type: z.string().nullish(),
  timestamp: num.nullish(),
  payload: z.object({
    symbol: z.string(),
    value: z.number(),
    /** 毫秒 */
    timestamp: num.nullish(),
    source: z.string().nullish(),
    stale: z.boolean().nullish(),
  }),
});
export type RtdsTickMessage = z.infer<typeof tickMessageSchema>;

const liveSourceSchema = z.object({
  symbol: z.string(),
  rtdsSymbol: z.string(),
  source: z.string(),
  topic: z.string(),
  declared: z.boolean().nullish(),
  subscription: z.object({
    topic: z.string(),
    type: z.string().nullish(),
    filters: z.string().nullish(),
  }),
});
export type RtdsLiveSource = z.infer<typeof liveSourceSchema>;

const candleSchema = z.object({
  /** 秒 */
  time: num,
  open: num,
  high: num,
  low: num,
  close: num,
});
export type RtdsCandle = z.infer<typeof candleSchema>;
export type RtdsCandleInterval = "1m" | "5m" | "15m" | "1h";

/** 5 秒没有新价就当作过期（网页版 RTDS_PRICE_STALE_AFTER_MS） */
export const PRICE_STALE_AFTER_MS = 5_000;

function query(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== "") qs.set(key, String(value));
  const text = qs.toString();
  return text ? `?${text}` : "";
}

export async function fetchLiveSource(
  service: PredictServiceConfig,
  input: {
    symbol: string;
    recurrence?: string;
    resolutionSource?: string | null;
  },
): Promise<RtdsLiveSource> {
  const hosts = platformHosts(service);
  return platformRequest({
    url: `${hosts.rtds}/api/v1/recurring/live-source${query({
      symbol: input.symbol,
      recurrence: input.recurrence,
      resolutionSource: input.resolutionSource ?? undefined,
    })}`,
    tenantDomain: service.domain,
    schema: liveSourceSchema,
  });
}

export async function fetchLatestPrice(
  service: PredictServiceConfig,
  input: { symbol: string; source?: string },
): Promise<RtdsTickMessage> {
  const hosts = platformHosts(service);
  return platformRequest({
    url: `${hosts.rtds}/api/v1/prices/latest${query(input)}`,
    tenantDomain: service.domain,
    schema: tickMessageSchema,
  });
}

export async function fetchPriceHistory(
  service: PredictServiceConfig,
  input: { symbol: string; source?: string; limit: number },
): Promise<RtdsTickMessage[]> {
  const hosts = platformHosts(service);
  const result = await platformRequest({
    url: `${hosts.rtds}/api/v1/prices/history${query(input)}`,
    tenantDomain: service.domain,
    schema: z.object({ messages: z.array(tickMessageSchema) }),
  });
  return result.messages;
}

export async function fetchCandles(
  service: PredictServiceConfig,
  input: {
    symbol: string;
    interval: RtdsCandleInterval;
    limit: number;
    source: string;
  },
): Promise<RtdsCandle[]> {
  const hosts = platformHosts(service);
  const result = await platformRequest({
    url: `${hosts.rtds}/api/v1/candles${query(input)}`,
    tenantDomain: service.domain,
    schema: z.object({ candles: z.array(candleSchema) }),
  });
  return result.candles;
}

// ---- WS ----

export type RtdsSubscription = { topic: string; filters: string };
type Listener = (message: RtdsTickMessage) => void;
const OPEN = 1;
const PING_INTERVAL_MS = 10_000;
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

function subscriptionKey(sub: RtdsSubscription): string {
  return `${sub.topic}|${sub.filters}`;
}

/**
 * RTDS 兼容 WS（`/api/v1/ws`）：`{"action":"subscribe","subscriptions":[{topic,type:"*",filters}]}`，
 * 推送 `{"topic","type":"update","payload":{symbol,value,timestamp,source}}`；客户端每 10 秒发文本 PING。
 * 没有订阅者时不建连接；断开后指数退避重连并重发订阅。
 */
export class RtdsWsClient {
  private socket: SocketLike | null = null;
  private readonly listeners = new Map<
    string,
    { sub: RtdsSubscription; set: Set<Listener> }
  >();
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

  subscribe(sub: RtdsSubscription, listener: Listener): () => void {
    const key = subscriptionKey(sub);
    const entry = this.listeners.get(key) ?? { sub, set: new Set<Listener>() };
    const fresh = entry.set.size === 0;
    entry.set.add(listener);
    this.listeners.set(key, entry);
    this.closed = false;
    if (!this.socket) this.connect();
    else if (this.socket.readyState === OPEN && fresh)
      this.send("subscribe", [sub]);
    return () => {
      const current = this.listeners.get(key);
      if (!current) return;
      current.set.delete(listener);
      if (current.set.size === 0) {
        this.listeners.delete(key);
        if (this.socket?.readyState === OPEN) this.send("unsubscribe", [sub]);
      }
      if (this.listeners.size === 0) this.disconnect();
    };
  }

  private send(
    action: "subscribe" | "unsubscribe",
    subs: RtdsSubscription[],
  ): void {
    this.socket?.send(
      JSON.stringify({
        action,
        subscriptions: subs.map((sub) => ({
          topic: sub.topic,
          type: "*",
          filters: sub.filters,
        })),
      }),
    );
  }

  private connect(): void {
    const create =
      this.deps.createSocket ??
      ((url: string) => new WebSocket(url) as unknown as SocketLike);
    const socket = create(`${this.deps.url}/api/v1/ws`);
    this.socket = socket;
    socket.onopen = () => {
      this.reconnectDelay = RECONNECT_MIN_MS;
      const subs = [...this.listeners.values()].map((entry) => entry.sub);
      if (subs.length > 0) this.send("subscribe", subs);
      this.pingTimer = setInterval(() => {
        if (socket.readyState === OPEN) socket.send("PING");
      }, PING_INTERVAL_MS);
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== "string" || event.data === "PONG") return;
      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch {
        return;
      }
      const parsed = tickMessageSchema.safeParse(raw);
      if (!parsed.success) return;
      for (const entry of this.listeners.values())
        if (entry.sub.topic === (parsed.data.topic ?? "") || !parsed.data.topic)
          for (const listener of entry.set) listener(parsed.data);
    };
    socket.onclose = () => {
      this.clearPing();
      this.socket = null;
      if (!this.closed && this.listeners.size > 0) this.scheduleReconnect();
    };
    socket.onerror = () => {};
  }

  private disconnect(): void {
    this.closed = true;
    this.clearPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }

  private clearPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
      if (!this.closed && this.listeners.size > 0) this.connect();
    }, this.reconnectDelay);
  }
}
