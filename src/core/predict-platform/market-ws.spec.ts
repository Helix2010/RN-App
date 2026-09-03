import {
  MarketWsClient,
  type MarketWsEvent,
  type SocketLike,
} from "./market-ws";

class FakeSocket implements SocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  receive(payload: unknown): void {
    this.onmessage?.({
      data: typeof payload === "string" ? payload : JSON.stringify(payload),
    });
  }

  drop(): void {
    this.readyState = 3;
    this.onclose?.({});
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({});
  }

  frames(): unknown[] {
    return this.sent
      .filter((item) => item !== "PING")
      .map((item) => JSON.parse(item) as unknown);
  }
}

function client(): MarketWsClient {
  return new MarketWsClient({
    url: "wss://clob-ws.predict.prax1s.xyz/ws/market",
    createSocket: (url) => new FakeSocket(url),
  });
}

beforeEach(() => {
  FakeSocket.instances = [];
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("MarketWsClient", () => {
  it("sends the market subscription with initial_dump and level, and again for tokens added later", () => {
    const ws = client();
    const events: MarketWsEvent[] = [];
    ws.subscribe(["111"], 2, (event) => events.push(event));
    const socket = FakeSocket.instances[0]!;
    expect(socket.url).toBe("wss://clob-ws.predict.prax1s.xyz/ws/market");
    socket.open();
    expect(socket.frames()).toEqual([
      {
        assets_ids: ["111"],
        type: "market",
        custom_feature_enabled: true,
        initial_dump: true,
        level: 2,
      },
    ]);
    const stop = ws.subscribe(["222"], 1, () => {});
    // 新增代币也走 market 帧：服务端只增不清，并推它的初始 dump（operation:"subscribe" 不推）
    expect(socket.frames().at(-1)).toEqual({
      assets_ids: ["222"],
      type: "market",
      custom_feature_enabled: true,
      initial_dump: true,
      level: 1,
    });
    stop();
    expect(socket.frames().at(-1)).toEqual({
      operation: "unsubscribe",
      assets_ids: ["222"],
    });
  });

  it("maps the initial book dump (nested in data), live books and price changes; ignores PONG and strangers", () => {
    const ws = client();
    const events: MarketWsEvent[] = [];
    ws.subscribe(["111"], 2, (event) => events.push(event));
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.receive("PONG");
    socket.receive({
      event_type: "book",
      asset_id: "111",
      data: {
        market: "0xc1",
        asset_id: "111",
        bids: [{ price: "0.60", size: "10" }],
        asks: [{ price: "0.64", size: "5" }],
        tick_size: "0.01",
        timestamp: "1800000000000",
      },
    });
    socket.receive({
      event_type: "price_change",
      market: "0xc1",
      price_changes: [
        {
          asset_id: "111",
          price: "0.63",
          size: "2",
          side: "BUY",
          best_bid: "0.61",
          best_ask: "0.63",
        },
        { asset_id: "999", price: "0.5", size: "1", side: "SELL" },
      ],
      timestamp: "1800000001000",
    });
    socket.receive({ event_type: "tick_size_change", asset_id: "111" });
    // 实测服务端会发空的 price_change 与 last_trade_price
    socket.receive({
      event_type: "price_change",
      asset_id: "111",
      market: "",
      price_changes: [],
      timestamp: "",
    });
    socket.receive({
      event_type: "last_trade_price",
      asset_id: "111",
      data: { price: "0.260000" },
    });
    socket.receive({
      event_type: "book",
      asset_id: "111",
      bids: [{ price: "0.61", size: "3" }],
      asks: [],
    });
    expect(events).toEqual([
      {
        kind: "book",
        assetId: "111",
        book: expect.objectContaining({
          asset_id: "111",
          bids: [{ price: 0.6, size: 10 }],
          asks: [{ price: 0.64, size: 5 }],
          tick_size: 0.01,
        }),
      },
      {
        kind: "price_change",
        assetId: "111",
        price: 0.63,
        bestBid: 0.61,
        bestAsk: 0.63,
      },
      { kind: "last_trade", assetId: "111", price: 0.26 },
      {
        kind: "book",
        assetId: "111",
        book: expect.objectContaining({ bids: [{ price: 0.61, size: 3 }] }),
      },
    ]);
  });

  it("pings every 10 seconds and re-subscribes after a dropped connection with backoff", () => {
    const ws = client();
    ws.subscribe(["111"], 2, () => {});
    const first = FakeSocket.instances[0]!;
    first.open();
    jest.advanceTimersByTime(20_000);
    expect(first.sent.filter((item) => item === "PING")).toHaveLength(2);
    first.drop();
    // 1 秒后重连
    expect(FakeSocket.instances).toHaveLength(1);
    jest.advanceTimersByTime(1_000);
    const second = FakeSocket.instances[1]!;
    // 没握手就又掉线：退避翻倍到 2 秒
    second.drop();
    jest.advanceTimersByTime(1_500);
    expect(FakeSocket.instances).toHaveLength(2);
    jest.advanceTimersByTime(600);
    const third = FakeSocket.instances[2]!;
    third.open();
    // 握手成功后重发全部订阅，退避回到 1 秒（同 user-dapp polymarket.ts onopen）
    expect(third.frames()[0]).toEqual({
      assets_ids: ["111"],
      type: "market",
      custom_feature_enabled: true,
      initial_dump: true,
      level: 2,
    });
    third.drop();
    jest.advanceTimersByTime(1_000);
    expect(FakeSocket.instances).toHaveLength(4);
  });

  it("ignores a late close from a superseded socket: no ping stop, no extra reconnect", () => {
    const ws = client();
    ws.subscribe(["111"], 2, () => {});
    const first = FakeSocket.instances[0]!;
    first.open();
    first.drop();
    jest.advanceTimersByTime(1_000);
    const second = FakeSocket.instances[1]!;
    second.open();
    // 旧 socket 的 close 事件迟到（真机上 onclose 可能在新连接建立后才回调）
    first.drop();
    jest.advanceTimersByTime(10_000);
    // 新连接的心跳还在
    expect(second.sent.filter((item) => item === "PING")).toHaveLength(1);
    // 也没有因为旧 close 再开一条连接
    jest.advanceTimersByTime(30_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("closes the socket when the last subscriber leaves and does not reconnect", () => {
    const ws = client();
    const stop = ws.subscribe(["111"], 2, () => {});
    const socket = FakeSocket.instances[0]!;
    socket.open();
    stop();
    expect(socket.closed).toBe(true);
    jest.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
