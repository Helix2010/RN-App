import { memoryStorage } from "../../../core/gateways/types";
import {
  resetMockRandom,
  useMockRuntime,
} from "../../../core/mock/mock-runtime";
import {
  fromDecimal,
  toApproxNumber,
  toDecimalString,
} from "../../../core/money/money";
import { FIXTURE_NOW } from "../fixtures/events";
import { MockPredictGateway } from "./mock-predict-gateway";

const ADDRESS = "0x3f4a8c21b7d94e0a1f6c5d2e8b9a7c3d4e5f9a2c";
const BASE_OFFSET = new Date(FIXTURE_NOW).getTime() - Date.now();

describe("MockPredictGateway", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetMockRandom();
    useMockRuntime.getState().reset();
    // Mock 时钟锚定到夹具时间，避免真实时间流逝改变市场状态
    useMockRuntime.getState().set({ clockOffsetMs: BASE_OFFSET });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("lists tags and events with live prices and paging", async () => {
    const gateway = new MockPredictGateway(memoryStorage());
    const tags = await gateway.listTags();
    expect(tags.map((tag) => tag.id)).toContain("crypto");
    const page = await gateway.listEvents({
      tagId: "hot",
      sort: "volume",
      limit: 2,
    });
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBe("2");
    expect(page.items[0]?.volumeUsd).toBeGreaterThanOrEqual(
      page.items[1]?.volumeUsd ?? 0,
    );
    const event = await gateway.getEvent("btc-close-above-120k-aug-31");
    expect(event.markets[0]?.yesPriceCents).toBeGreaterThan(0);
  });

  it("returns empty lists in empty mode and fails when offline", async () => {
    const gateway = new MockPredictGateway(memoryStorage());
    useMockRuntime.getState().set({ emptyMode: true });
    expect((await gateway.listEvents({})).items).toHaveLength(0);
    useMockRuntime.getState().set({ emptyMode: false, offline: true });
    await expect(gateway.listTags()).rejects.toMatchObject({ kind: "network" });
  });

  it("fills a market buy, moves balance and creates a position", async () => {
    const gateway = new MockPredictGateway(memoryStorage());
    const before = await gateway.getBalance(ADDRESS);
    const preview = await gateway.previewOrder(ADDRESS, {
      marketId: "m-btc-120k",
      outcome: "yes",
      side: "buy",
      type: "market",
      amount: fromDecimal("100", 6, "USDC"),
    });
    expect(toDecimalString(preview.fee)).toBe("0.2");
    expect(preview.estimatedShares).toBeGreaterThan(150);
    const result = await gateway.placeOrder(ADDRESS, {
      marketId: "m-btc-120k",
      outcome: "yes",
      side: "buy",
      type: "market",
      amount: fromDecimal("100", 6, "USDC"),
    });
    expect(result.status).toBe("filled");
    const after = await gateway.getBalance(ADDRESS);
    expect(
      toApproxNumber(before.available) - toApproxNumber(after.available),
    ).toBeCloseTo(100, 5);
    const position = (await gateway.listPositions(ADDRESS)).find(
      (item) => item.marketId === "m-btc-120k" && item.outcome === "yes",
    );
    expect(position?.shares).toBeGreaterThan(120);
    expect((await gateway.listActivity(ADDRESS))[0]?.type).toBe("TRADE");
  });

  it("parks a non-crossing limit order and releases funds on cancel", async () => {
    const gateway = new MockPredictGateway(memoryStorage());
    const before = await gateway.getBalance(ADDRESS);
    const result = await gateway.placeOrder(ADDRESS, {
      marketId: "m-btc-120k",
      outcome: "yes",
      side: "buy",
      type: "limit",
      shares: 100,
      priceCents: 40,
      tif: "GTC",
    });
    expect(result.status).toBe("open");
    const locked = await gateway.getBalance(ADDRESS);
    expect(
      toApproxNumber(locked.lockedInOrders) -
        toApproxNumber(before.lockedInOrders),
    ).toBeCloseTo(40, 5);
    await gateway.cancelOrder(ADDRESS, result.orderId);
    const released = await gateway.getBalance(ADDRESS);
    expect(toApproxNumber(released.available)).toBeCloseTo(
      toApproxNumber(before.available),
      5,
    );
  });

  it("exposes settled, disputed and trading statuses from the adjudication state machine", async () => {
    const gateway = new MockPredictGateway(memoryStorage());
    expect((await gateway.getAdjudication("m-cpi-jul")).status).toBe("settled");
    expect((await gateway.getAdjudication("m-mun-liv")).status).toBe(
      "arbitrating",
    );
    const positions = await gateway.listPositions(ADDRESS);
    const claimable = positions.find((item) => item.marketId === "m-cpi-jul");
    expect(claimable?.redeemable).toBe(true);
    expect(claimable?.curPriceCents).toBe(100);
    const balanceBefore = await gateway.getBalance(ADDRESS);
    expect(toDecimalString(balanceBefore.claimable)).toBe("186");
    const tx = await gateway.redeem(ADDRESS, [claimable?.id ?? ""]);
    expect(tx.kind).toBe("redeem");
    const balanceAfter = await gateway.getBalance(ADDRESS);
    expect(
      toApproxNumber(balanceAfter.available) -
        toApproxNumber(balanceBefore.available),
    ).toBeCloseTo(186, 5);
    expect(toDecimalString(balanceAfter.claimable)).toBe("0");
  });

  it("proposes and auto-settles after the market ends when the clock advances", async () => {
    const gateway = new MockPredictGateway(memoryStorage());
    expect((await gateway.getAdjudication("m-eth-4500")).status).toBe(
      "trading",
    );
    useMockRuntime
      .getState()
      .set({ clockOffsetMs: BASE_OFFSET + 2 * 24 * 3_600_000 });
    const proposed = await gateway.getAdjudication("m-eth-4500");
    expect(proposed.status).toBe("settled");
    expect(proposed.settledOutcome).toBeDefined();
    await expect(
      gateway.placeOrder(ADDRESS, {
        marketId: "m-eth-4500",
        outcome: "yes",
        side: "buy",
        type: "market",
        amount: fromDecimal("10", 6, "USDC"),
      }),
    ).rejects.toThrow(/closed/);
  });

  it("locks a bond when disputing a proposed result", async () => {
    const gateway = new MockPredictGateway(memoryStorage());
    // 让 ETH 今日市场刚过截止 + 提交结果，但仍在争议期内
    useMockRuntime
      .getState()
      .set({ clockOffsetMs: BASE_OFFSET + 13 * 3_600_000 });
    const proposed = await gateway.getAdjudication("m-eth-4500");
    expect(proposed.status).toBe("result_proposed");
    expect(proposed.canDispute).toBe(true);
    const before = await gateway.getBalance(ADDRESS);
    await gateway.submitDispute(ADDRESS, "m-eth-4500", "数据源错误");
    const after = await gateway.getBalance(ADDRESS);
    expect(
      toApproxNumber(before.available) - toApproxNumber(after.available),
    ).toBeCloseTo(50, 5);
    expect((await gateway.getAdjudication("m-eth-4500")).status).toBe(
      "disputed",
    );
  });

  it("splits collateral into yes/no shares and merges back", async () => {
    const gateway = new MockPredictGateway(memoryStorage());
    const before = await gateway.getBalance(ADDRESS);
    await gateway.splitOrMerge(
      ADDRESS,
      "m-fomc-25",
      "split",
      fromDecimal("100", 6, "USDC"),
    );
    const positions = await gateway.listPositions(ADDRESS);
    expect(
      positions.find((p) => p.marketId === "m-fomc-25" && p.outcome === "yes")
        ?.shares,
    ).toBe(100);
    expect(
      positions.find((p) => p.marketId === "m-fomc-25" && p.outcome === "no")
        ?.shares,
    ).toBe(100);
    await gateway.splitOrMerge(
      ADDRESS,
      "m-fomc-25",
      "merge",
      fromDecimal("100", 6, "USDC"),
    );
    const after = await gateway.getBalance(ADDRESS);
    expect(toApproxNumber(after.available)).toBeCloseTo(
      toApproxNumber(before.available),
      5,
    );
  });

  it("persists state across instances", async () => {
    const storage = memoryStorage();
    const first = new MockPredictGateway(storage);
    await first.placeOrder(ADDRESS, {
      marketId: "m-btc-120k",
      outcome: "no",
      side: "buy",
      type: "market",
      amount: fromDecimal("10", 6, "USDC"),
    });
    const second = new MockPredictGateway(storage);
    const positions = await second.listPositions(ADDRESS);
    expect(
      positions.some((p) => p.marketId === "m-btc-120k" && p.outcome === "no"),
    ).toBe(true);
  });
  it("refuses to place an order when the mock runtime injects a failure, leaving the balance untouched", async () => {
    const gateway = new MockPredictGateway(memoryStorage());
    const before = await gateway.getBalance(ADDRESS);
    useMockRuntime.getState().set({ failureRate: 1 });
    await expect(
      gateway.placeOrder(ADDRESS, {
        marketId: "m-btc-120k",
        outcome: "yes",
        side: "buy",
        type: "market",
        amount: fromDecimal("100", 6, "USDC"),
      }),
    ).rejects.toMatchObject({ kind: "server" });
    useMockRuntime.getState().set({ failureRate: 0 });
    const after = await gateway.getBalance(ADDRESS);
    expect(toDecimalString(after.available)).toBe(
      toDecimalString(before.available),
    );
  });
});
