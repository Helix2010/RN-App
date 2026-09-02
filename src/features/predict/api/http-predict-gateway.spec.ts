import { getAddress } from "ethers";
import { fromDecimal } from "../../../core/money/money";
import { setPlatformFetch } from "../../../core/predict-platform/tenant-client";
import type { HttpPredictAccountGateway } from "./http-predict-account-gateway";
import {
  HttpPredictGateway,
  PredictUnsupportedError,
} from "./http-predict-gateway";

const DOMAIN = "predict.prax1s.xyz";
const SCOPE = `0x${"fb".repeat(32)}`;
const SAFE = "0x79ec2b3b2C34b583c1a4c1408f45AC01B5731740";
const EOA = getAddress("0xb38b3e94803b22facb0bb488192eaf2032dffc7c");
const CONDITION = `0x${"c1".repeat(32)}`;
const service = {
  domain: DOMAIN,
  scopeId: SCOPE,
  chain: "op-sepolia" as const,
};

type Seen = { url: URL; method: string; headers: Record<string, string> };

function platform() {
  const seen: Seen[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const event = {
    id: 42,
    slug: "btc-120k",
    title: "Will BTC hit 120k?",
    titleTranslation: '{"zh": "BTC 会到 12 万吗？"}',
    description: "Resolves YES if…",
    resolutionSource: "Coinbase",
    endDate: "2026-12-31T00:00:00Z",
    active: true,
    closed: false,
    featured: true,
    volume: "1000",
    tags: [{ id: 3, label: "Crypto", slug: "crypto", tagType: "category" }],
    markets: [
      {
        id: 7,
        conditionId: CONDITION,
        question: "Will BTC hit 120k?",
        outcomes: '["Yes","No"]',
        outcomePrices: '["0.62","0.38"]',
        clobTokenIds: '["111","222"]',
        volume: "1000",
        endDate: "2026-12-31T00:00:00Z",
        bestBid: "0.60",
        bestAsk: "0.64",
        lastTradePrice: "0.61",
        adjudication: null,
      },
    ],
  };
  setPlatformFetch(async (input, init) => {
    const url = new URL(String(input));
    seen.push({
      url,
      method: (init?.method ?? "GET").toUpperCase(),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const host = url.host.split(".")[0];
    const path = url.pathname;
    if (host === "gamma-api") {
      if (path === "/tags")
        return json([
          {
            id: 9,
            label: "Hot",
            labelTranslation: '{"zh":"热门"}',
            slug: "hot",
          },
          { id: 3, label: "Crypto", slug: "crypto" },
        ]);
      if (path === "/events") return json([event]);
      if (path === "/events/slug/btc-120k" || path === "/events/42")
        return json(event);
      if (path === "/markets/information")
        return json([{ ...event.markets[0], eventSlug: "btc-120k" }]);
    }
    if (host === "clob-api") {
      if (path === "/time") return json(1_800_000_000);
      if (path === "/book")
        return json({
          market: CONDITION,
          asset_id: url.searchParams.get("token_id"),
          bids: [{ price: "0.60", size: "150.5" }],
          asks: [{ price: "0.64", size: "80" }],
          tick_size: "0.01",
          timestamp: "1800000000000",
        });
      if (path.startsWith("/fee-rate/")) return json({ base_fee: 20 });
      if (path === "/price-history")
        return json({
          history: [
            { t: 1_799_990_000, p: "0.5" },
            { t: 1_800_000_000, p: 0.62 },
          ],
        });
      if (path === "/orders")
        return json([
          {
            id: "o-1",
            status: "ORDER_STATUS_LIVE",
            owner: "key",
            maker_address: SAFE,
            market: CONDITION,
            asset_id: "111",
            side: "BUY",
            outcome: "Yes",
            original_size: "10",
            size_matched: "2.5",
            price: "0.61",
            order_type: "GTC",
            created_at: 1_799_999_000,
            expiration: "0",
          },
          {
            id: "o-2",
            status: "ORDER_STATUS_MATCHED",
            market: CONDITION,
            asset_id: "111",
            side: "BUY",
            original_size: "1",
            size_matched: "1",
            price: "0.5",
          },
        ]);
    }
    if (host === "data-api") {
      if (path === "/positions")
        return json({
          data: [
            {
              proxyWallet: SAFE,
              asset: "111",
              conditionId: CONDITION,
              size: "12.5",
              avgPrice: "0.55",
              initialValue: "6.875",
              currentValue: "7.75",
              cashPnl: "0.875",
              percentPnl: "12.7",
              curPrice: "0.62",
              redeemable: false,
              marketClosed: false,
              title: "Will BTC hit 120k?",
              eventSlug: "btc-120k",
              outcome: "Yes",
              outcomeIndex: 0,
            },
          ],
        });
      if (path === "/activity")
        return json([
          {
            type: "TRADE",
            conditionId: CONDITION,
            asset: "111",
            side: "BUY",
            price: 0.55,
            size: 12.5,
            usdcSize: 6.875,
            timestamp: 1_799_990_000,
            title: "Will BTC hit 120k?",
            outcome: "Yes",
            outcomeIndex: 0,
          },
        ]);
      if (path === "/v1/leaderboard")
        return json({
          data: [
            {
              rank: "1",
              proxyWallet: SAFE,
              userName: "ann",
              pnl: 12.5,
              vol: 300,
            },
          ],
          biggestWins: [],
        });
    }
    return json({ error: `no route ${url.href}` }, 404);
  });
  return seen;
}

function build() {
  const seen = platform();
  const account = {
    platformContext: async () => ({ service, contracts: {} }),
    tradingContext: async () => ({
      service,
      contracts: {},
      chainId: 11155420,
      safe: SAFE,
      jwt: "jwt",
      clob: { apiKey: "key", secret: "c2VjcmV0", passphrase: "pass" },
    }),
  } as unknown as HttpPredictAccountGateway;
  return { gateway: new HttpPredictGateway({ account }), seen };
}

afterEach(() => setPlatformFetch(null));

describe("HttpPredictGateway", () => {
  it("maps carousel tags and events into the app model (conditionId as market id, cents, token ids)", async () => {
    const { gateway, seen } = build();
    const tags = await gateway.listTags();
    expect(tags.map((tag) => [tag.id, tag.label])).toEqual([
      ["9", { default: "Hot", zh: "热门" }],
      ["3", { default: "Crypto" }],
    ]);
    const page = await gateway.listEvents({
      tagId: "3",
      sort: "endingSoon",
      limit: 1,
    });
    expect(page.nextCursor).toBe("1");
    const [event] = page.items;
    expect(event?.id).toBe("42");
    expect(event?.slug).toBe("btc-120k");
    expect(event?.kind).toBe("binary");
    expect(event?.holders).toBeNull();
    expect(event?.title).toEqual({
      default: "Will BTC hit 120k?",
      zh: "BTC 会到 12 万吗？",
    });
    const [market] = event?.markets ?? [];
    expect(market).toMatchObject({
      id: CONDITION,
      eventId: "42",
      yesPriceCents: 62,
      yesTokenId: "111",
      noTokenId: "222",
      volumeUsd: 1000,
    });
    for (const request of seen)
      expect(request.headers["X-Tenant-Domain"]).toBe(DOMAIN);
  });

  it("reads the YES-token order book and price history for a market", async () => {
    const { gateway, seen } = build();
    const book = await gateway.getOrderBook(CONDITION);
    expect(book.bids).toEqual([{ priceCents: 60, shares: 150.5 }]);
    expect(book.asks).toEqual([{ priceCents: 64, shares: 80 }]);
    expect(book.tickCents).toBe(1);
    expect(book.updatedAt).toBe("2027-01-15T08:00:00.000Z");
    const bookRequest = seen.find((r) => r.url.pathname === "/book");
    expect(bookRequest?.url.searchParams.get("token_id")).toBe("111");
    const history = await gateway.getPriceHistory(CONDITION, "1w");
    expect(history).toEqual([
      { t: "2027-01-15T05:13:20.000Z", priceCents: 50 },
      { t: "2027-01-15T08:00:00.000Z", priceCents: 62 },
    ]);
    expect(await gateway.getFeeBps(CONDITION)).toBe(20);
  });

  it("lists positions, activity and open orders for the Safe with L2 headers on the CLOB call", async () => {
    const { gateway, seen } = build();
    const positions = await gateway.listPositions(EOA);
    expect(positions).toHaveLength(1);
    expect(positions[0]).toMatchObject({
      id: `${CONDITION}:111`,
      marketId: CONDITION,
      eventId: "btc-120k",
      outcome: "yes",
      shares: 12.5,
      avgPriceCents: 55,
      curPriceCents: 62,
      status: "trading",
      redeemable: false,
    });
    expect(positions[0]?.value).toEqual(fromDecimal("7.75", 6, "USDC"));
    expect(
      seen
        .find((r) => r.url.pathname === "/positions")
        ?.url.searchParams.get("user"),
    ).toBe(SAFE);

    const activity = await gateway.listActivity(EOA);
    expect(activity[0]).toMatchObject({ type: "TRADE", marketId: CONDITION });
    // 买入是出账
    expect(activity[0]?.amount).toEqual(fromDecimal("-6.875", 6, "USDC"));

    const orders = await gateway.listOpenOrders(EOA);
    // MATCHED 的不算未完成
    expect(orders.map((order) => order.id)).toEqual(["o-1"]);
    expect(orders[0]).toMatchObject({
      marketId: CONDITION,
      outcome: "yes",
      side: "buy",
      type: "limit",
      priceCents: 61,
      shares: 10,
      filledShares: 2.5,
      tif: "GTC",
    });
    const ordersRequest = seen.find((r) => r.url.pathname === "/orders");
    expect(ordersRequest?.headers.PRED_API_KEY).toBe("key");
    expect(ordersRequest?.headers.PRED_ADDRESS).toBe(EOA);
    expect(ordersRequest?.headers.PRED_SIGNATURE).toBeDefined();
  });

  it("maps the leaderboard and refuses capabilities the platform does not offer", async () => {
    const { gateway, seen } = build();
    const board = await gateway.getLeaderboard("week", "volume");
    expect(board).toEqual([
      { rank: 1, address: SAFE, name: "ann", pnlUsd: 12.5, volumeUsd: 300 },
    ]);
    const request = seen.find((r) => r.url.pathname === "/v1/leaderboard");
    expect(request?.url.searchParams.get("orderBy")).toBe("VOL");
    expect(request?.url.searchParams.get("timePeriod")).toBe("WEEK");
    await expect(gateway.submitDispute()).rejects.toBeInstanceOf(
      PredictUnsupportedError,
    );
    await expect(
      gateway.placeOrder(EOA, {
        marketId: CONDITION,
        outcome: "yes",
        side: "buy",
        type: "market",
      }),
    ).rejects.toBeInstanceOf(PredictUnsupportedError);
  });
});
