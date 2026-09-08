import { Interface, Wallet, getAddress } from "ethers";
import { fromDecimal } from "../../../core/money/money";
import {
  YES_OR_NO_IDENTIFIER,
  ZERO_ADDRESS,
  conditionalTokens,
  erc20,
  lightOracle,
  negRiskAdapter,
  oracleAdapter,
  usdWrapper,
} from "../../../core/predict-platform/contracts";
import { setPlatformFetch } from "../../../core/predict-platform/tenant-client";
import type { WalletSigner } from "../../../core/wallet/signer/types";
import type { WalletGateway } from "../../wallet/api/gateway";
import type { OnchainTransfers } from "../../wallet/api/onchain-transfers";
import type { HttpPredictAccountGateway } from "./http-predict-account-gateway";
import { HttpPredictGateway } from "./http-predict-gateway";

const DOMAIN = "predict.prax1s.xyz";
const SCOPE = `0x${"fb".repeat(32)}`;
const SAFE = "0x79ec2b3b2C34b583c1a4c1408f45AC01B5731740";
const EOA = getAddress("0xb38b3e94803b22facb0bb488192eaf2032dffc7c");
const CONDITION = `0x${"c1".repeat(32)}`;
const SETTLED_CONDITION = `0x${"ee".repeat(32)}`;
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
    image: "https://images.example.net/events/btc.png",
    icon: "",
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
  const series = {
    id: 5,
    slug: "btc-updown-5m",
    title: "BTC Up or Down · 5m",
    titleTranslation: '{"zh":"BTC 5 分钟涨跌"}',
    seriesType: "crypto_periodic",
    recurrence: "5m",
    active: true,
    closed: false,
  };
  setPlatformFetch(async (input, init) => {
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    seen.push({
      url,
      method,
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
      if (path === "/curation/events")
        return json([
          // hero + highlight（位掩码 6），各自有独立次序
          {
            ...event,
            featuredLevel: 6,
            featuredOrder: 9,
            featuredOrderHero: 1,
            featuredOrderHighlight: 3,
          },
          // 只有 normal 位（1），没有专门次序时退到 featuredOrder
          {
            ...event,
            id: 43,
            slug: "eth-5k",
            featuredLevel: 1,
            featuredOrder: 2,
          },
          { ...event, id: 44, slug: "sol-300", featuredLevel: 0 },
        ]);
      if (path === "/series") return json([series]);
      if (path === "/series/slug/btc-updown-5m") return json(series);
      if (path === "/series/5/periods")
        return json({
          data: [
            {
              id: 9,
              seriesId: 5,
              eventId: 42,
              marketId: 7,
              windowStart: "2027-01-01T00:00:00Z",
              windowEnd: "2027-01-01T00:05:00Z",
              stage: "published",
              priceToBeat: {
                price: "65000.5",
                source: "binance",
                sampledAt: "2027-01-01T00:00:00Z",
              },
              finalPrice: null,
              result: null,
              event,
            },
            {
              id: 8,
              seriesId: 5,
              eventId: 41,
              marketId: 6,
              windowStart: "2026-12-31T23:55:00Z",
              windowEnd: "2027-01-01T00:00:00Z",
              stage: "settled",
              priceToBeat: { price: 64990 },
              finalPrice: { price: "65000.5", source: "binance" },
              result: "up",
            },
          ],
        });
    }
    if (host === "geo-api" && path === "/geoblock")
      return json({ restricted: true });
    if (host === "data-api" && path === "/holders")
      return json([
        {
          token: "111",
          holders: [
            {
              proxyWallet: "0xaaa",
              name: "Alice",
              pseudonym: "Quiet-Fox",
              amount: "12.5",
              outcomeIndex: 0,
              displayUsernamePublic: true,
            },
            {
              proxyWallet: "0xbbb",
              name: "Bob",
              pseudonym: "Loud-Owl",
              amount: 40,
              outcomeIndex: 0,
              displayUsernamePublic: false,
            },
          ],
        },
        {
          token: "222",
          holders: [{ proxyWallet: "0xccc", amount: 3, outcomeIndex: 1 }],
        },
      ]);
    if (host === "gamma-api") {
      if (path === "/markets/information")
        return json([
          {
            ...event.markets[0],
            eventSlug: "btc-120k",
            adjudication: adjudicationOverride,
          },
        ]);
      if (path === "/disputes/evidence" && method === "POST") {
        evidencePosts.push(JSON.parse(String(init?.body)) as unknown);
        return evidenceResponse
          ? json(evidenceResponse.body, evidenceResponse.status)
          : json({ evidenceId: 77 });
      }
    }
    if (host === "clob-api") {
      if (path === "/time") return json(1_800_000_000);
      if (path === "/book")
        return json({
          market: CONDITION,
          asset_id: url.searchParams.get("token_id"),
          bids: [{ price: "0.60", size: "150.5" }],
          // 簿的 tick 可到 0.1¢：0.645 要显示成 64.5¢，不能四舍五入成 65¢
          asks: [
            { price: "0.64", size: "80" },
            { price: "0.645", size: "1" },
          ],
          tick_size: "0.01",
          timestamp: "1800000000000",
        });
      if (path.startsWith("/fee-rate/")) return json({ base_fee: 20 });
      if (path === "/tick-size") return json({ minimum_tick_size: "0.01" });
      if (path === "/order" && method === "POST") {
        const body = JSON.parse(String(init?.body)) as {
          order: { makerAmount: string; takerAmount: string; side: string };
        };
        // FAK 零成交时平台回 status canceled、两个金额都是 0（match_dispatcher.go:1922-1930）
        const fill =
          orderStatus === "canceled"
            ? "0"
            : String(
                Number(
                  body.order.side === "BUY"
                    ? body.order.takerAmount
                    : body.order.makerAmount,
                ) / 1e6,
              );
        return json({
          success: true,
          errorMsg: "",
          orderID: "o-new",
          // matcher.go 把 CollateralAmount / OutcomeAmount 都写成 fillAmount（份数）：两个字段一样，拿不到成交额
          takingAmount: fill,
          makingAmount: fill,
          status: orderStatus,
          transactionsHashes: [`0x${"cd".repeat(32)}`],
          tradeIDs: ["t-1"],
        });
      }
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
          {
            id: "o-3",
            status: "ORDER_STATUS_LIVE",
            market: CONDITION,
            asset_id: "222",
            side: "SELL",
            // 文案故意写错：方向必须按 token id 对回市场
            outcome: "Yes",
            original_size: "3",
            size_matched: "0",
            price: "0.4",
            order_type: "GTC",
          },
          {
            id: "o-4",
            status: "ORDER_STATUS_LIVE",
            market: CONDITION,
            asset_id: "999",
            side: "BUY",
            original_size: "1",
            size_matched: "0",
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
            {
              proxyWallet: SAFE,
              asset: "333",
              conditionId: SETTLED_CONDITION,
              size: "4",
              avgPrice: "0.30",
              initialValue: "1.2",
              currentValue: "4",
              cashPnl: "2.8",
              percentPnl: "233.3",
              // 结算后 data-service 把 curPrice 换成结算价（positions.go:426-455）：赢 1
              curPrice: "1",
              redeemable: true,
              marketClosed: true,
              title: "Did ETH flip BTC?",
              // 只有市场 slug、没有事件 slug
              slug: "eth-flip-market",
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
          {
            // 平台新增的类型：跳过，不硬按成交显示
            type: "AIRDROP",
            conditionId: CONDITION,
            asset: "111",
            price: 0,
            size: 1,
            usdcSize: 1,
            timestamp: 1_799_990_001,
            title: "Will BTC hit 120k?",
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

/** 假平台 /markets/information 返回的 adjudication；null = 没有裁决数据 */
let adjudicationOverride: Record<string, unknown> | null = null;
/** 假平台 POST /disputes/evidence 的应答（null = 200 {evidenceId}）与收到的请求体 */
let evidenceResponse: { status: number; body: unknown } | null = null;
const evidencePosts: unknown[] = [];

const CONTRACTS = {
  umaAdapter: getAddress(`0x${"0a".repeat(20)}`),
  negRiskUmaAdapter: getAddress(`0x${"0b".repeat(20)}`),
  sportsOracle: getAddress(`0x${"0c".repeat(20)}`),
  usdw: getAddress(`0x${"01".repeat(20)}`),
  usdcUnderlying: getAddress(`0x${"02".repeat(20)}`),
  usdwWrapper: getAddress(`0x${"03".repeat(20)}`),
  multiSend: getAddress(`0x${"04".repeat(20)}`),
  safeFactory: getAddress(`0x${"05".repeat(20)}`),
  ctf: getAddress(`0x${"06".repeat(20)}`),
  ctfExchange: getAddress(`0x${"07".repeat(20)}`),
  negRiskAdapter: getAddress(`0x${"08".repeat(20)}`),
  negRiskExchange: getAddress(`0x${"09".repeat(20)}`),
  usdwDecimals: 6,
  usdcDecimals: 6,
};

function build(
  options: {
    onchain?: Partial<OnchainTransfers>;
    service?: typeof service & { endpoints?: { geo?: string } };
  } = {},
) {
  const seen = platform();
  const wallet = Wallet.createRandom();
  const relayed: { to: string; data: string; operation: number }[] = [];
  const account = {
    platformContext: async () => ({
      service: options.service ?? service,
      contracts: CONTRACTS,
    }),
    tradingContext: async () => ({
      service,
      contracts: CONTRACTS,
      chainId: 11155420,
      safe: SAFE,
      jwt: "jwt",
      clob: { apiKey: "key", secret: "c2VjcmV0", passphrase: "pass" },
    }),
    relaySafe: async (
      _address: string,
      call: { to: string; data: string; operation: number },
    ) => {
      relayed.push(call);
      return `0x${"ab".repeat(32)}`;
    },
  } as unknown as HttpPredictAccountGateway;
  const signer: WalletSigner = {
    address: wallet.address,
    managesOwnFees: false,
    signMessage: (message) => wallet.signMessage(message),
    signTypedData: (domain, types, value) =>
      wallet.signTypedData(domain, types, value),
    submitTransaction: async () => {
      throw new Error("not used");
    },
  };
  const walletGateway = {
    signerFor: async () => signer,
  } as unknown as WalletGateway;
  // 链上 ERC1155 余额：Safe 手里每个代币 5 份
  const onchain = {
    readContract: async () => `0x${5_000_000n.toString(16).padStart(64, "0")}`,
    ...options.onchain,
  } as unknown as OnchainTransfers;
  return {
    gateway: new HttpPredictGateway({
      account,
      wallet: walletGateway,
      onchain,
      now: () => 1_800_000_000_000,
      sleep: async () => {},
    }),
    seen,
    relayed,
    wallet,
  };
}

afterEach(() => setPlatformFetch(null));

const cleanup: (() => void)[] = [];
/** 假平台 POST /order 的应答状态：matched（默认）/ canceled（FAK 零成交） */
let orderStatus = "matched";
afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
  orderStatus = "matched";
  adjudicationOverride = null;
  evidenceResponse = null;
  evidencePosts.length = 0;
  jest.restoreAllMocks();
});

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
    expect(event?.closed).toBe(false);
    expect(event?.tags.map((tag) => tag.id)).toEqual(["3"]);
    // 图片：平台给了 URL 才有；空串当作没有
    expect(event?.imageUrl).toBe("https://images.example.net/events/btc.png");
    expect(event?.iconUrl).toBeNull();
    expect(event?.markets[0]?.iconUrl).toBeNull();
    expect(event?.title).toEqual({
      default: "Will BTC hit 120k?",
      zh: "BTC 会到 12 万吗？",
    });
    // 分类标签 = 首个标签的名称，不是数字 id
    expect(event?.categoryTagId).toBe("3");
    expect(event?.category).toEqual({ default: "Crypto" });
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

  it("maps the status filter and sort to gamma query params", async () => {
    const { gateway, seen } = build();
    await gateway.listEvents({ sort: "volume", limit: 1 });
    await gateway.listEvents({ sort: "volume24h", status: "closed", limit: 1 });
    await gateway.listEvents({ sort: "liquidity", status: "all", limit: 1 });
    const calls = seen
      .filter((call) => call.url.pathname === "/events")
      .map((call) => call.url.searchParams);
    expect(calls[0]?.get("active")).toBe("true");
    expect(calls[0]?.get("closed")).toBe("false");
    expect(calls[0]?.get("order")).toBe("volume");
    expect(calls[1]?.get("closed")).toBe("true");
    expect(calls[1]?.get("active")).toBeNull();
    expect(calls[1]?.get("order")).toBe("volume24hr");
    expect(calls[2]?.get("closed")).toBeNull();
    expect(calls[2]?.get("active")).toBeNull();
    // 流动性平台不排序：按成交量取回来本地排
    expect(calls[2]?.get("order")).toBe("volume");
  });

  it("ranks curated events by the featuredLevel bitmask and per-tier order", async () => {
    const { gateway } = build();
    const curated = await gateway.listCuratedEvents();
    expect(
      curated.map((item) => [item.hero, item.highlight, item.normal]),
    ).toEqual([
      [1, 3, null],
      [null, null, 2],
      [null, null, null],
    ]);
    expect(curated[0]?.event.id).toBe("42");
  });

  it("groups holders by outcome, sorts by shares and names them name → pseudonym like the web", async () => {
    const { gateway, seen } = build();
    const groups = await gateway.getHolders(CONDITION);
    const call = seen.find((item) => item.url.pathname === "/holders");
    expect(call?.url.host).toBe(`data-api.${DOMAIN}`);
    expect(call?.url.searchParams.get("market")).toBe(CONDITION);
    expect(call?.url.searchParams.get("limit")).toBe("10");
    expect(groups.map((group) => group.outcome)).toEqual(["yes", "no"]);
    expect(groups[0]?.holders).toEqual([
      { address: "0xbbb", name: "Bob", shares: 40 },
      { address: "0xaaa", name: "Alice", shares: 12.5 },
    ]);
    expect(groups[1]?.holders).toEqual([
      { address: "0xccc", name: null, shares: 3 },
    ]);
  });

  it("maps series and their periods, trading through the period event's conditionId", async () => {
    const { gateway, seen } = build();
    const list = await gateway.listSeries();
    expect(list.map((item) => item.slug)).toEqual(["btc-updown-5m"]);
    // 首页最多 8 个系列（每个都轮询当期）
    expect(
      seen
        .find((item) => item.url.pathname === "/series")
        ?.url.searchParams.get("limit"),
    ).toBe("8");
    const series = await gateway.getSeries("btc-updown-5m", "5");
    expect(series).toEqual({
      id: "5",
      slug: "btc-updown-5m",
      title: { default: "BTC Up or Down · 5m", zh: "BTC 5 分钟涨跌" },
      recurrence: "5m",
      seriesType: "crypto_periodic",
      ticker: null,
    });
    // 带 series_id 定位，避免同名 slug 打开别的系列
    expect(
      seen
        .find((item) => item.url.pathname === "/series/slug/btc-updown-5m")
        ?.url.searchParams.get("series_id"),
    ).toBe("5");
    const periods = await gateway.listSeriesPeriods("5", "current", 2);
    const call = seen.find((item) => item.url.pathname === "/series/5/periods");
    expect(call?.url.searchParams.get("current")).toBe("true");
    expect(call?.url.searchParams.get("limit")).toBe("2");
    expect(periods[0]).toMatchObject({
      id: "9",
      seriesId: "5",
      eventId: "42",
      marketId: CONDITION,
      stage: "published",
      priceToBeat: { price: "65000.5", source: "binance" },
      finalPrice: null,
      result: null,
    });
    expect(periods[0]?.event?.id).toBe("42");
    // 没带事件的历史期：没有 conditionId 就是 null（不拿 gamma 数字 id 冒充），结果与结算价原样映射
    expect(periods[1]).toMatchObject({
      marketId: null,
      priceToBeat: { price: "64990", source: "" },
      finalPrice: { price: "65000.5", source: "binance" },
      result: "up",
    });
    expect(periods[1]?.event).toBeUndefined();
    await gateway.listSeriesPeriods("5", "closed", 12);
    const closedCall = seen
      .filter((item) => item.url.pathname === "/series/5/periods")
      .at(-1);
    expect(closedCall?.url.searchParams.get("closed")).toBe("true");
    expect(closedCall?.url.searchParams.get("current")).toBeNull();
  });

  it("reports a market order that filled nothing as canceled instead of open", async () => {
    orderStatus = "canceled";
    const { gateway } = build();
    const result = await gateway.placeOrder(EOA, {
      marketId: CONDITION,
      outcome: "yes",
      side: "buy",
      type: "market",
      amount: fromDecimal("10", 6, "USDW"),
    });
    expect(result).toMatchObject({ status: "canceled", filledShares: 0 });
  });

  it("rejects a market buy whose tick-aligned makerAmount falls under the platform's 1 USDC floor", async () => {
    const { gateway, seen } = build();
    await expect(
      gateway.placeOrder(EOA, {
        marketId: CONDITION,
        outcome: "yes",
        side: "buy",
        type: "market",
        amount: fromDecimal("1", 6, "USDW"),
      }),
    ).rejects.toThrow(/at least 1.01 USDW/);
    expect(
      seen.some((r) => r.url.pathname === "/order" && r.method === "POST"),
    ).toBe(false);
  });

  it("rejects a limit price off the book's tick grid before signing or posting anything", async () => {
    const { gateway, seen } = build();
    await expect(
      gateway.placeOrder(EOA, {
        marketId: CONDITION,
        outcome: "yes",
        side: "buy",
        type: "limit",
        shares: 10,
        // 簿 tick 1¢，62.3¢ 不在网格上（平台会 400 ORDER_PRICE_NOT_ALIGNED）
        priceCents: 62.3,
        tif: "GTC",
      }),
    ).rejects.toThrow(/multiple of the market tick/);
    expect(
      seen.some((r) => r.url.pathname === "/order" && r.method === "POST"),
    ).toBe(false);
  });

  it("positions and open orders carry the market question so the UI needs no fixture lookup", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    const { gateway } = build();
    const [position] = await gateway.listPositions(EOA);
    expect(position?.title).toEqual({ default: "Will BTC hit 120k?" });
    expect(position?.outcomeLabel).toBeNull();
    expect(position?.endsAt).toBeNull();
    const orders = await gateway.listOpenOrders(EOA);
    expect(orders[0]?.title).toEqual({ default: "Will BTC hit 120k?" });
    expect(orders[0]?.eventId).toBe("btc-120k");
  });

  it("reads the YES-token order book and price history for a market", async () => {
    const { gateway, seen } = build();
    const book = await gateway.getOrderBook(CONDITION);
    expect(book.bids).toEqual([{ priceCents: 60, shares: 150.5 }]);
    expect(book.asks).toEqual([
      { priceCents: 64, shares: 80 },
      { priceCents: 64.5, shares: 1 },
    ]);
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
    expect(positions).toHaveLength(2);
    // 结算赢家：结算价 1 → 可领 100¢；接口只有市场 slug 时不拿它充当事件 id
    expect(positions[1]).toMatchObject({
      marketId: SETTLED_CONDITION,
      eventId: "",
      status: "settled",
      redeemable: true,
      settledPayoutCents: 100,
    });
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
    expect(positions[0]?.value).toEqual(fromDecimal("7.75", 6, "USDW"));
    expect(
      seen
        .find((r) => r.url.pathname === "/positions")
        ?.url.searchParams.get("user"),
    ).toBe(SAFE);

    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const activity = await gateway.listActivity(EOA);
    // 未知类型 AIRDROP 被跳过并留痕
    expect(activity).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("unknown activity type AIRDROP"),
    );
    expect(activity[0]).toMatchObject({ type: "TRADE", marketId: CONDITION });
    // 买入是出账
    expect(activity[0]?.amount).toEqual(fromDecimal("-6.875", 6, "USDW"));

    const orders = await gateway.listOpenOrders(EOA);
    // MATCHED 的不算未完成；asset 不属于该市场的（o-4）跳过
    expect(orders.map((order) => order.id)).toEqual(["o-1", "o-3"]);
    // 方向按 token id：222 是 NO token，不信 outcome 文案
    expect(orders[1]).toMatchObject({ outcome: "no", side: "sell" });
    warn.mockRestore();
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
  });

  it("places a market buy as a FAK order: best ask, tick-aligned amounts, Safe as maker, L2 headers", async () => {
    const { gateway, seen, wallet } = build();
    const result = await gateway.placeOrder(EOA, {
      marketId: CONDITION,
      outcome: "yes",
      side: "buy",
      type: "market",
      amount: fromDecimal("10", 6, "USDW"),
    });
    const post = seen.find(
      (r) => r.url.pathname === "/order" && r.method === "POST",
    );
    expect(post?.headers.PRED_API_KEY).toBe("key");
    expect(post?.headers.PRED_ADDRESS).toBe(EOA);
    // 卖一 0.64 → 10 USDC 买到 15.62 份；应答只给份数（taking = making），均价 / 成本 / 手续费不编
    expect(result).toMatchObject({
      orderId: "o-new",
      status: "filled",
      filledShares: 15.62,
      avgPriceCents: null,
      cost: null,
      fee: null,
    });
    // 订单的 signer 是钱包地址（EOA），maker 是 Safe
    const sentBody = JSON.parse(
      String((post as unknown as { body?: string }).body ?? "{}"),
    ) as { order?: { signer?: string; maker?: string } };
    if (sentBody.order) {
      expect(sentBody.order.signer).toBe(wallet.address);
      expect(sentBody.order.maker).toBe(SAFE);
    }
  });

  it("previews a market buy by walking the asks and a sell by walking the bids", async () => {
    const { gateway } = build();
    const buy = await gateway.previewOrder(EOA, {
      marketId: CONDITION,
      outcome: "yes",
      side: "buy",
      type: "market",
      amount: fromDecimal("10", 6, "USDW"),
    });
    // 沿卖一 0.64 吃到 15.62 份；手续费 = 15.62 × min(0.64, 0.36) × 20 / 1e4 = 0.0112464 USDW，
    // 买入从份额里扣（÷ 0.64 ≈ 0.0176 份）→ 到手 15.60 份
    expect(buy.estimatedShares).toBe(15.6);
    expect(buy.avgPriceCents).toBe(64);
    expect(buy.fee).toEqual(fromDecimal("0.011246", 6, "USDW"));
    expect(buy.potentialPayout).toEqual(fromDecimal("15.6", 6, "USDW"));
    expect(buy.potentialReturnPct).toBeCloseTo(56, 0);
    // 卖一 0.64：1.00 USDW 对齐后 makerAmount = 0.64 × 1.56 = 0.9984 < 1 USDC 会被平台拒，最小要 1.01
    expect(buy.minAmount).toEqual(fromDecimal("1.01", 6, "USDW"));
    const sell = await gateway.previewOrder(EOA, {
      marketId: CONDITION,
      outcome: "yes",
      side: "sell",
      type: "market",
      shares: 20,
    });
    // 买一 0.60 只有 150.5 份，20 份全吃得到
    expect(sell.estimatedShares).toBe(20);
    expect(sell.cost).toEqual(fromDecimal("12", 6, "USDW"));
    // 卖出手续费 = 20 × min(0.60, 0.40) × 20 / 1e4 = 0.016 USDW，从回款里扣
    expect(sell.fee).toEqual(fromDecimal("0.016", 6, "USDW"));
    expect(sell.potentialPayout).toEqual(fromDecimal("11.984", 6, "USDW"));
    expect(sell.potentialReturnPct).toBeNull();
    expect(sell.minAmount).toBeNull();
  });

  it("redeems settled positions with one MultiSend of CTF.redeemPositions per condition", async () => {
    const { gateway, relayed } = build();
    const tx = await gateway.redeem(EOA, [
      `${CONDITION}:111`,
      `${CONDITION}:222`,
    ]);
    expect(tx.kind).toBe("redeem");
    expect(tx.status).toBe("confirmed");
    expect(relayed).toHaveLength(1);
    expect(relayed[0]?.to).toBe(CONTRACTS.multiSend);
    expect(relayed[0]?.operation).toBe(1);
    const expected = conditionalTokens.encodeFunctionData("redeemPositions", [
      CONTRACTS.usdw,
      `0x${"00".repeat(32)}`,
      CONDITION,
      [1n, 2n],
    ]);
    expect(relayed[0]?.data).toContain(expected.slice(2));
    expect(await gateway.getTx(tx.id)).toEqual(tx);
  });

  it("splits and merges through a direct Safe call to the CTF (operation 0)", async () => {
    const { gateway, relayed } = build();
    await gateway.splitOrMerge(
      EOA,
      CONDITION,
      "split",
      fromDecimal("3", 6, "USDW"),
    );
    await gateway.splitOrMerge(
      EOA,
      CONDITION,
      "merge",
      fromDecimal("1", 6, "USDW"),
    );
    expect(relayed.map((call) => [call.to, call.operation])).toEqual([
      [CONTRACTS.ctf, 0],
      [CONTRACTS.ctf, 0],
    ]);
    expect(relayed[0]?.data).toBe(
      conditionalTokens.encodeFunctionData("splitPosition", [
        CONTRACTS.usdw,
        `0x${"00".repeat(32)}`,
        CONDITION,
        [1n, 2n],
        3_000_000n,
      ]),
    );
    expect(relayed[1]?.data).toBe(
      conditionalTokens.encodeFunctionData("mergePositions", [
        CONTRACTS.usdw,
        `0x${"00".repeat(32)}`,
        CONDITION,
        [1n, 2n],
        1_000_000n,
      ]),
    );
    // negRisk 的编码器也要能用
    expect(
      negRiskAdapter.encodeFunctionData("splitPosition", [CONDITION, 1n]),
    ).toMatch(/^0x/);
  });

  it("subscribes the YES token on the market channel and maps book / price_change events", async () => {
    type FakeSock = {
      url: string;
      sent: string[];
      onopen: ((e: unknown) => void) | null;
      onmessage: ((e: { data: unknown }) => void) | null;
      onclose: ((e: unknown) => void) | null;
      onerror: ((e: unknown) => void) | null;
      readyState: number;
      send(d: string): void;
      close(): void;
    };
    const sockets: FakeSock[] = [];
    const seenMarkets = platform();
    const account = {
      platformContext: async () => ({ service, contracts: CONTRACTS }),
    } as unknown as HttpPredictAccountGateway;
    const gateway = new HttpPredictGateway({
      account,
      wallet: {} as WalletGateway,
      onchain: {} as OnchainTransfers,
      createSocket: (url) => {
        const socket = {
          url,
          sent: [] as string[],
          onopen: null,
          onmessage: null,
          onclose: null,
          onerror: null,
          readyState: 0,
          send(d: string) {
            this.sent.push(d);
          },
          close() {
            this.readyState = 3;
          },
        };
        sockets.push(socket);
        return socket;
      },
    });
    const events: unknown[] = [];
    const stop = gateway.subscribeMarkets([CONDITION], (event) =>
      events.push(event),
    );
    // 断言失败也要断开，否则 10 秒 PING 定时器会让 jest 永不退出
    cleanup.push(stop);
    // 市场 → 代币解析是异步的（走 /markets/information）
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      seenMarkets.some((r) => r.url.pathname === "/markets/information"),
    ).toBe(true);
    const socket = sockets[0]!;
    expect(socket.url).toBe("wss://clob-ws.predict.prax1s.xyz/ws/market");
    socket.readyState = 1;
    socket.onopen?.({});
    expect(JSON.parse(socket.sent[0] ?? "{}")).toEqual({
      assets_ids: ["111"],
      type: "market",
      custom_feature_enabled: true,
      initial_dump: true,
      level: 2,
    });
    socket.onmessage?.({
      data: JSON.stringify({
        event_type: "book",
        asset_id: "111",
        data: {
          asset_id: "111",
          bids: [{ price: "0.60", size: "1" }],
          asks: [{ price: "0.66", size: "2" }],
          tick_size: "0.01",
          // 初始 dump 的时间戳是 ISO 串（实测）
          timestamp: "2027-01-15T08:00:00Z",
        },
      }),
    });
    // 有簿价时成交价只是回落，不再推价
    socket.onmessage?.({
      data: JSON.stringify({
        event_type: "last_trade_price",
        asset_id: "111",
        data: { price: "0.700000" },
      }),
    });
    socket.onmessage?.({
      data: JSON.stringify({
        event_type: "price_change",
        market: CONDITION,
        price_changes: [
          {
            asset_id: "111",
            price: "0.63",
            size: "1",
            side: "BUY",
            best_bid: "0.61",
            best_ask: "0.63",
          },
        ],
      }),
    });
    // 簿事件之外再推一条由簿算出的价格（mid 60/66 → 63），同网页版概率来源；显式 price_change 用 best_bid/ask 的 mid
    // 成交价单独推一条 last_trade（盘口的"最新"一行用它），但有簿价时不再当作展示价
    expect(events).toEqual([
      {
        type: "book",
        book: {
          marketId: CONDITION,
          bids: [{ priceCents: 60, shares: 1 }],
          asks: [{ priceCents: 66, shares: 2 }],
          tickCents: 1,
          minOrderShares: 1,
          lastTradeCents: null,
          updatedAt: "2027-01-15T08:00:00.000Z",
        },
      },
      { type: "price_change", marketId: CONDITION, yesPriceCents: 63 },
      { type: "last_trade", marketId: CONDITION, priceCents: 70 },
      { type: "price_change", marketId: CONDITION, yesPriceCents: 62 },
    ]);
    stop();
    expect(socket.readyState).toBe(3);
  });
});

// ---- 争议（review-2026-09-05 §4.3）----

const ORACLE = getAddress(`0x${"0e".repeat(20)}`);
const ADAPTER = CONTRACTS.umaAdapter;
const BOND = 5_000_000n;
const OPEN_UNTIL = 1_800_000_600n;
const LIVE_ADJUDICATION = {
  status: "proposed",
  proposedOutcome: "Yes",
  proposedAt: "2027-01-15T07:50:00Z",
  livenessDeadline: "2027-01-15T08:10:00Z",
  livenessSecs: 600,
  currentPhase: "liveness_period",
  adapterInstance: "regular",
  ancillaryData: "0xabcd",
  requestTimestamp: 1_799_999_000,
};
const EVIDENCE =
  "The reported price was taken from the wrong exchange and does not match the resolution source named in the market description. ".repeat(
    2,
  );

function selectorOf(iface: Interface, name: string): string {
  const fragment = iface.getFunction(name);
  if (!fragment) throw new Error(`no function ${name}`);
  return fragment.selector;
}
const hex = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;

function disputeChain(
  options: {
    usdw?: bigint;
    usdc?: bigint;
    allowance?: bigint;
    expirationTime?: bigint;
    reverted?: boolean;
  } = {},
) {
  const calls: { to: string; data: string; label?: string }[] = [];
  let allowance = options.allowance ?? 0n;
  const onchain = {
    readContract: async (_chain: string, to: string, data: string) => {
      const selector = data.slice(0, 10);
      if (selector === selectorOf(oracleAdapter, "optimisticOracle"))
        return hex(BigInt(ORACLE));
      if (selector === selectorOf(lightOracle, "getRequest"))
        return lightOracle.encodeFunctionResult("getRequest", [
          [
            ZERO_ADDRESS,
            ZERO_ADDRESS,
            CONTRACTS.usdw,
            false,
            [false, false, false, false, false, BOND, 0n],
            10n ** 18n,
            0n,
            options.expirationTime ?? OPEN_UNTIL,
            0n,
            0n,
          ],
        ]);
      if (selector === selectorOf(erc20, "balanceOf"))
        return hex(
          to === CONTRACTS.usdw
            ? (options.usdw ?? 100_000_000n)
            : (options.usdc ?? 0n),
        );
      if (selector === selectorOf(erc20, "allowance")) return hex(allowance);
      throw new Error(`unexpected read ${selector} on ${to}`);
    },
    nativeBalance: async () => 10n ** 18n,
    callContract: async (
      _chain: string,
      call: { to: string; data: string; label?: string },
    ) => {
      calls.push(call);
      if (call.data.startsWith(selectorOf(erc20, "approve"))) allowance = BOND;
      return { hash: `0x${calls.length.toString(16).padStart(64, "0")}` };
    },
    receiptOf: async () => ({
      status: options.reverted ? "reverted" : "success",
      blockNumber: 1,
    }),
  };
  return { onchain: onchain as unknown as Partial<OnchainTransfers>, calls };
}

describe("HttpPredictGateway disputes", () => {
  it("reads the dispute terms from the adapter's oracle and exposes the dispute key", async () => {
    adjudicationOverride = LIVE_ADJUDICATION;
    const { onchain } = disputeChain({ usdw: 3_000_000n, usdc: 9_000_000n });
    const { gateway } = build({ onchain });
    const adj = await gateway.getAdjudication(CONDITION);
    expect(adj).toMatchObject({
      status: "result_proposed",
      phase: "liveness_period",
      adapter: "regular",
      canDispute: true,
      disputeKey: {
        requester: ADAPTER,
        identifier: YES_OR_NO_IDENTIFIER,
        requestTimestamp: "1799999000",
        ancillaryData: "0xabcd",
      },
    });
    const terms = await gateway.getDisputeTerms(EOA, CONDITION);
    expect(terms).toMatchObject({
      oracle: ORACLE,
      bond: { raw: "5000000", decimals: 6, symbol: "USDW" },
      usdwBalance: { raw: "3000000" },
      usdcBalance: { raw: "9000000", symbol: "USDC" },
      nativeBalance: { raw: (10n ** 18n).toString(), symbol: "ETH" },
      expiresAt: new Date(Number(OPEN_UNTIL) * 1000).toISOString(),
    });
  });

  it("runs evidence → bond → approve → dispute with the EOA paying gas, then shows the dispute optimistically", async () => {
    adjudicationOverride = LIVE_ADJUDICATION;
    const { onchain, calls } = disputeChain({ usdw: BOND });
    const { gateway, seen } = build({ onchain });
    const steps: string[] = [];
    const tx = await gateway.submitDispute(
      EOA,
      CONDITION,
      { evidence: EVIDENCE, links: [" https://source.example/a ", ""] },
      (step) => steps.push(step),
    );
    expect(steps).toEqual(["evidence", "bond", "approve", "dispute"]);
    expect(evidencePosts).toEqual([
      {
        conditionId: CONDITION,
        disputer: EOA,
        evidence: EVIDENCE.trim(),
        links: ["https://source.example/a"],
      },
    ]);
    expect(
      seen.find((r) => r.url.pathname === "/disputes/evidence")?.headers[
        "X-Tenant-Domain"
      ],
    ).toBe(DOMAIN);
    expect(calls.map((call) => call.to)).toEqual([CONTRACTS.usdw, ORACLE]);
    expect(calls[0]?.data).toBe(
      erc20.encodeFunctionData("approve", [ORACLE, BOND]),
    );
    expect(calls[1]?.data).toBe(
      lightOracle.encodeFunctionData("disputePrice", [
        ADAPTER,
        YES_OR_NO_IDENTIFIER,
        1_799_999_000n,
        "0xabcd",
      ]),
    );
    expect(tx).toMatchObject({ kind: "dispute", status: "confirmed" });
    const after = await gateway.getAdjudication(CONDITION);
    expect(after).toMatchObject({
      status: "disputed",
      disputedBy: EOA,
      canDispute: false,
    });
  });

  it("skips the approval when the allowance already covers the bond", async () => {
    adjudicationOverride = LIVE_ADJUDICATION;
    const { onchain, calls } = disputeChain({ allowance: BOND });
    const { gateway } = build({ onchain });
    const steps: string[] = [];
    await gateway.submitDispute(
      EOA,
      CONDITION,
      { evidence: EVIDENCE, links: [] },
      (step) => steps.push(step),
    );
    expect(steps).toEqual(["evidence", "bond", "dispute"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.to).toBe(ORACLE);
  });

  it("stops before any signature when the address holds less USDW than the bond", async () => {
    adjudicationOverride = LIVE_ADJUDICATION;
    const { onchain, calls } = disputeChain({ usdw: 1_000_000n });
    const { gateway } = build({ onchain });
    await expect(
      gateway.submitDispute(EOA, CONDITION, { evidence: EVIDENCE, links: [] }),
    ).rejects.toMatchObject({
      name: "PredictInsufficientBondError",
      shortfall: { raw: "4000000" },
    });
    expect(calls).toHaveLength(0);
  });

  it("maps the platform's 409 to already_disputed without touching the chain", async () => {
    adjudicationOverride = LIVE_ADJUDICATION;
    evidenceResponse = {
      status: 409,
      body: {
        error: "a dispute has already been submitted for this market round",
        message: "a dispute has already been submitted for this market round",
      },
    };
    const { onchain, calls } = disputeChain();
    const { gateway } = build({ onchain });
    await expect(
      gateway.submitDispute(EOA, CONDITION, { evidence: EVIDENCE, links: [] }),
    ).rejects.toMatchObject({
      name: "PredictDisputeError",
      reason: "already_disputed",
    });
    expect(calls).toHaveLength(0);
  });

  it("refuses to broadcast once the on-chain window has expired", async () => {
    adjudicationOverride = LIVE_ADJUDICATION;
    const { onchain, calls } = disputeChain({
      allowance: BOND,
      expirationTime: 1_799_999_999n,
    });
    const { gateway } = build({ onchain });
    await expect(
      gateway.submitDispute(EOA, CONDITION, { evidence: EVIDENCE, links: [] }),
    ).rejects.toMatchObject({
      name: "PredictDisputeError",
      reason: "window_closed",
    });
    expect(calls).toHaveLength(0);
  });

  it("rejects evidence that fails the client-side rules before calling the platform", async () => {
    adjudicationOverride = LIVE_ADJUDICATION;
    const { onchain } = disputeChain();
    const { gateway } = build({ onchain });
    await expect(
      gateway.submitDispute(EOA, CONDITION, {
        evidence: "too short",
        links: [],
      }),
    ).rejects.toMatchObject({ reason: "evidence_rejected" });
    expect(evidencePosts).toHaveLength(0);
  });

  it("checks the region only when the tenant configured a geo endpoint", async () => {
    const plain = build();
    await expect(plain.gateway.checkRegion()).resolves.toEqual({
      restricted: false,
      checked: false,
    });
    expect(plain.seen.some((item) => item.url.pathname === "/geoblock")).toBe(
      false,
    );
    const gated = build({
      service: {
        ...service,
        endpoints: { geo: `https://geo-api.${DOMAIN}` },
      },
    });
    await expect(gated.gateway.checkRegion()).resolves.toEqual({
      restricted: true,
      checked: true,
    });
    expect(
      gated.seen.find((item) => item.url.pathname === "/geoblock")?.url.host,
    ).toBe(`geo-api.${DOMAIN}`);
  });

  it("surfaces the platform's cancellation phases as a canceled status", async () => {
    adjudicationOverride = {
      ...LIVE_ADJUDICATION,
      status: "canceled",
      currentPhase: "cancellation_pending",
    };
    const { gateway } = build();
    const adj = await gateway.getAdjudication(CONDITION);
    expect(adj.status).toBe("canceled");
    expect(adj.phase).toBe("cancellation_pending");
    expect(adj.canDispute).toBe(false);
  });

  it("treats crypto_periodic markets as non-disputable", async () => {
    adjudicationOverride = {
      ...LIVE_ADJUDICATION,
      adapterInstance: "crypto_periodic",
    };
    const { onchain } = disputeChain();
    const { gateway } = build({ onchain });
    const adj = await gateway.getAdjudication(CONDITION);
    expect(adj.canDispute).toBe(false);
    expect(adj.disputeKey).toBeUndefined();
    await expect(gateway.getDisputeTerms(EOA, CONDITION)).rejects.toMatchObject(
      { reason: "unsupported_adapter" },
    );
  });

  it("wraps wallet USDC into USDW at the EOA itself", async () => {
    const { onchain, calls } = disputeChain();
    const { gateway } = build({ onchain });
    const steps: string[] = [];
    await gateway.wrapForDispute(EOA, fromDecimal("4", 6, "USDC"), (step) =>
      steps.push(step),
    );
    expect(steps).toEqual(["approve", "wrap"]);
    expect(calls.map((call) => call.to)).toEqual([
      CONTRACTS.usdcUnderlying,
      CONTRACTS.usdwWrapper,
    ]);
    expect(calls[1]?.data).toBe(
      usdWrapper.encodeFunctionData("wrap", [
        CONTRACTS.usdcUnderlying,
        4_000_000n,
        EOA,
      ]),
    );
  });
});
