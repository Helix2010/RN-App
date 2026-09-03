import { Wallet, getAddress } from "ethers";
import { fromDecimal } from "../../../core/money/money";
import {
  conditionalTokens,
  negRiskAdapter,
} from "../../../core/predict-platform/contracts";
import { setPlatformFetch } from "../../../core/predict-platform/tenant-client";
import type { WalletSigner } from "../../../core/wallet/signer/types";
import type { WalletGateway } from "../../wallet/api/gateway";
import type { OnchainTransfers } from "../../wallet/api/onchain-transfers";
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

const CONTRACTS = {
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

function build() {
  const seen = platform();
  const wallet = Wallet.createRandom();
  const relayed: { to: string; data: string; operation: number }[] = [];
  const account = {
    platformContext: async () => ({ service, contracts: CONTRACTS }),
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
  } as unknown as OnchainTransfers;
  return {
    gateway: new HttpPredictGateway({
      account,
      wallet: walletGateway,
      onchain,
      now: () => 1_800_000_000_000,
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
    expect(event?.holders).toBeNull();
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
    await expect(gateway.submitDispute()).rejects.toBeInstanceOf(
      PredictUnsupportedError,
    );
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
    expect(events).toEqual([
      {
        type: "book",
        book: {
          marketId: CONDITION,
          bids: [{ priceCents: 60, shares: 1 }],
          asks: [{ priceCents: 66, shares: 2 }],
          tickCents: 1,
          minOrderShares: 1,
          updatedAt: "2027-01-15T08:00:00.000Z",
        },
      },
      { type: "price_change", marketId: CONDITION, yesPriceCents: 63 },
      { type: "price_change", marketId: CONDITION, yesPriceCents: 62 },
    ]);
    stop();
    expect(socket.readyState).toBe(3);
  });
});
