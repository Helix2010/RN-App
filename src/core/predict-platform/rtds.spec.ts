import type { SocketLike } from "./market-ws";
import {
  RtdsWsClient,
  fetchCandles,
  fetchLiveSource,
  fetchPriceHistory,
  resolveCryptoSymbol,
} from "./rtds";
import { setPlatformFetch } from "./tenant-client";

const service = {
  domain: "predict.prax1s.xyz",
  scopeId: `0x${"fb".repeat(32)}`,
  chain: "op-sepolia" as const,
  endpoints: { rtds: "https://predict.prax1s.xyz/rtds" },
};

afterEach(() => setPlatformFetch(null));

describe("crypto symbol resolution", () => {
  it("prefers the ticker, then the slug / title, and refuses to guess", () => {
    expect(resolveCryptoSymbol({ ticker: "BTCUSD", slug: "x" })).toBe("BTCUSD");
    expect(resolveCryptoSymbol({ ticker: "eth-usdt", slug: "x" })).toBe(
      "ETHUSD",
    );
    expect(resolveCryptoSymbol({ ticker: null, slug: "btc-updown-5m" })).toBe(
      "BTCUSD",
    );
    expect(
      resolveCryptoSymbol({
        ticker: null,
        slug: "s",
        title: "Solana up or down",
      }),
    ).toBe("SOLUSD");
    expect(
      resolveCryptoSymbol({ ticker: null, slug: "gold-updown-5m" }),
    ).toBeNull();
  });
});

describe("rtds rest", () => {
  it("asks the live source with recurrence and resolution declaration, history with a limit, candles with a source", async () => {
    const seen: string[] = [];
    setPlatformFetch(async (input) => {
      const url = String(input);
      seen.push(url);
      const body = url.includes("live-source")
        ? {
            symbol: "BTCUSD",
            rtdsSymbol: "btc/usd",
            recurrence: "5m",
            source: "polymarket_twap_30",
            topic: "crypto_prices_twap_thirty",
            declared: false,
            subscription: {
              topic: "crypto_prices_twap_thirty",
              type: "update",
              filters: '{"source":"polymarket_twap_30","symbol":"btc/usd"}',
            },
          }
        : url.includes("history")
          ? {
              messages: [
                {
                  topic: "crypto_prices_twap_thirty",
                  type: "update",
                  timestamp: 1_788_856_735_548,
                  payload: {
                    symbol: "btc/usd",
                    value: 78518.33,
                    timestamp: 1_788_856_734_000,
                    source: "polymarket_twap_30",
                  },
                },
              ],
            }
          : {
              candles: [
                {
                  time: 1_788_856_560,
                  open: "78534.01",
                  high: 78542.03,
                  low: 78500.37,
                  close: 78540.91,
                },
              ],
              source: "binance",
            };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const live = await fetchLiveSource(service, {
      symbol: "BTCUSD",
      recurrence: "5m",
      resolutionSource:
        "https://data.chain.link/streams/btc-usd-twap-60s-streams",
    });
    expect(live.subscription.topic).toBe("crypto_prices_twap_thirty");
    const history = await fetchPriceHistory(service, {
      symbol: "BTCUSD",
      source: "polymarket_twap_30",
      limit: 360,
    });
    expect(history[0]?.payload.value).toBe(78518.33);
    const candles = await fetchCandles(service, {
      symbol: "BTCUSD",
      interval: "1m",
      limit: 30,
      source: "binance",
    });
    expect(candles[0]).toEqual({
      time: 1_788_856_560,
      open: 78534.01,
      high: 78542.03,
      low: 78500.37,
      close: 78540.91,
    });
    expect(seen[0]).toBe(
      "https://predict.prax1s.xyz/rtds/api/v1/recurring/live-source?symbol=BTCUSD&recurrence=5m&resolutionSource=https%3A%2F%2Fdata.chain.link%2Fstreams%2Fbtc-usd-twap-60s-streams",
    );
    expect(seen[1]).toBe(
      "https://predict.prax1s.xyz/rtds/api/v1/prices/history?symbol=BTCUSD&source=polymarket_twap_30&limit=360",
    );
    expect(seen[2]).toBe(
      "https://predict.prax1s.xyz/rtds/api/v1/candles?symbol=BTCUSD&interval=1m&limit=30&source=binance",
    );
  });

  it("passes endTime through when asked for candles before a past window's close", async () => {
    const seen: string[] = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ candles: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    await fetchCandles(service, {
      symbol: "BTCUSD",
      interval: "1m",
      limit: 5,
      source: "binance",
      endTime: 1_788_856_800_000,
    });
    expect(seen[0]).toBe(
      "https://predict.prax1s.xyz/rtds/api/v1/candles?symbol=BTCUSD&interval=1m&limit=5&source=binance&endTime=1788856800000",
    );
  });

  it("rejects a candle payload that breaks the contract", async () => {
    setPlatformFetch(
      async () =>
        new Response(JSON.stringify({ candles: [{ time: 1, open: "x" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      fetchCandles(service, {
        symbol: "BTCUSD",
        interval: "1m",
        limit: 1,
        source: "binance",
      }),
    ).rejects.toBeTruthy();
  });
});

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  closed = false;
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({});
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  push(data: unknown) {
    this.onmessage?.({
      data: typeof data === "string" ? data : JSON.stringify(data),
    });
  }
}

describe("rtds websocket client", () => {
  it("connects on the first subscriber, sends the subscribe frame and pings, routes ticks, and closes with the last unsubscribe", () => {
    jest.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const urls: string[] = [];
    const client = new RtdsWsClient({
      url: "wss://predict.prax1s.xyz/rtds-ws",
      createSocket: (url) => {
        urls.push(url);
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    const sub = {
      topic: "crypto_prices_twap_thirty",
      filters: '{"source":"polymarket_twap_30","symbol":"btc/usd"}',
    };
    const seen: number[] = [];
    const stop = client.subscribe(sub, (message) =>
      seen.push(message.payload.value),
    );
    expect(urls).toEqual(["wss://predict.prax1s.xyz/rtds-ws/api/v1/ws"]);
    const socket = sockets[0]!;
    socket.open();
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      action: "subscribe",
      subscriptions: [{ topic: sub.topic, type: "*", filters: sub.filters }],
    });
    jest.advanceTimersByTime(10_000);
    expect(socket.sent).toContain("PING");
    socket.push("PONG");
    socket.push({
      topic: sub.topic,
      type: "update",
      timestamp: 1,
      payload: {
        symbol: "btc/usd",
        value: 78500.5,
        timestamp: 1,
        source: "polymarket_twap_30",
      },
    });
    socket.push({
      topic: "other",
      type: "update",
      payload: { symbol: "eth/usd", value: 1 },
    });
    expect(seen).toEqual([78500.5]);
    stop();
    expect(socket.closed).toBe(true);
    jest.useRealTimers();
  });
});
