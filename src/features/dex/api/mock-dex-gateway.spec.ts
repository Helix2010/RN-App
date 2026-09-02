import { memoryStorage, type TokenRef } from "../../../core/gateways/types";
import {
  resetMockRandom,
  useMockRuntime,
} from "../../../core/mock/mock-runtime";
import { fromDecimal, toApproxNumber } from "../../../core/money/money";
import { MockWalletGateway } from "../../wallet/api/mock-wallet-gateway";
import { TOKENS } from "../../wallet/fixtures/wallet";
import { MockDexGateway } from "./mock-dex-gateway";

const ADDRESS = "0x3f4a8c21b7d94e0a1f6c5d2e8b9a7c3d4e5f9a2c";

describe("MockDexGateway", () => {
  beforeEach(() => {
    resetMockRandom();
    useMockRuntime.getState().reset();
    jest.useRealTimers();
  });

  async function setup() {
    const storage = memoryStorage();
    const wallet = new MockWalletGateway(storage);
    await wallet.connect("metamask");
    const dex = new MockDexGateway(storage, wallet);
    return { wallet, dex };
  }

  it("lists, sorts and searches tokens", async () => {
    const { dex } = await setup();
    const hot = await dex.listTokens({ sort: "hot" });
    expect(hot.items.length).toBeGreaterThan(3);
    const gainers = await dex.listTokens({ sort: "gainers", chain: "base" });
    expect(gainers.items.every((item) => item.token.chain === "base")).toBe(
      true,
    );
    expect(gainers.items[0]?.token.symbol).toBe("ZORA");
    const fresh = await dex.listTokens({ sort: "new" });
    expect(fresh.items.every((item) => item.isNew)).toBe(true);
    expect((await dex.searchTokens("pepe"))[0]?.token.symbol).toBe("PEPE");
  });

  it("returns token detail with security report and candles", async () => {
    const { dex } = await setup();
    const pepe = TOKENS.PEPE as TokenRef;
    const detail = await dex.getToken("bsc", pepe.address);
    expect(detail.security.passed).toBe(4);
    const mog = TOKENS.MOG as TokenRef;
    expect((await dex.getToken("eth", mog.address)).security.passed).toBe(1);
    const candles = await dex.getCandles("bsc", pepe.address, "4h");
    expect(candles).toHaveLength(60);
    expect(
      candles.every(
        (c) => c.h >= Math.max(c.o, c.c) && c.l <= Math.min(c.o, c.c),
      ),
    ).toBe(true);
  });

  it("quotes with impact, slippage and route; native sell needs no approval", async () => {
    const { dex } = await setup();
    const quote = await dex.quote({
      chain: "bsc",
      sellToken: TOKENS.BNB as TokenRef,
      buyToken: TOKENS.PEPE as TokenRef,
      amountIn: fromDecimal("0.5", 18, "BNB"),
    });
    expect(quote.route).toEqual(["BNB", "WBNB", "PEPE"]);
    expect(quote.needsApproval).toBe(false);
    expect(toApproxNumber(quote.minReceived)).toBeLessThan(
      toApproxNumber(quote.amountOut),
    );
    expect(quote.amountOutUsd).toBeLessThan(quote.amountInUsd);
    expect(quote.slippageAuto).toBe(true);
  });

  it("requires approval for ERC-20 sells until approved", async () => {
    const { dex } = await setup();
    const cake = TOKENS.CAKE as TokenRef;
    const router = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
    expect(await dex.needsApproval(ADDRESS, cake, router)).toBe(true);
    await dex.approve(ADDRESS, cake, router, true);
    expect(await dex.needsApproval(ADDRESS, cake, router)).toBe(false);
    const approvals = await dex.listApprovals(ADDRESS, "bsc");
    expect(
      approvals.some(
        (item) => item.token.symbol === "CAKE" && item.allowance === null,
      ),
    ).toBe(true);
  });

  it("swaps: debits the sell token, then credits on confirmation", async () => {
    jest.useFakeTimers();
    const { dex, wallet } = await setup();
    const bnb = TOKENS.BNB as TokenRef;
    const pepe = TOKENS.PEPE as TokenRef;
    const before = (await wallet.getBalances(ADDRESS, "bsc")).items;
    const quote = await dex.quote({
      chain: "bsc",
      sellToken: bnb,
      buyToken: pepe,
      amountIn: fromDecimal("0.5", 18, "BNB"),
    });
    const record = await dex.swap(ADDRESS, quote.id);
    expect(record.status).toBe("submitted");
    const afterDebit = (await wallet.getBalances(ADDRESS, "bsc")).items;
    const bnbBefore = before.find((b) => b.token.symbol === "BNB");
    const bnbAfter = afterDebit.find((b) => b.token.symbol === "BNB");
    expect(
      toApproxNumber(bnbBefore?.amount ?? fromDecimal("0", 18, "BNB")) -
        toApproxNumber(bnbAfter?.amount ?? fromDecimal("0", 18, "BNB")),
    ).toBeCloseTo(0.5, 6);
    await jest.advanceTimersByTimeAsync(5_000);
    const done = await dex.getSwap(record.id);
    expect(done?.status).toBe("confirmed");
    expect(done?.amountOut).toBeDefined();
    const pepeAfter = (await wallet.getBalances(ADDRESS, "bsc")).items.find(
      (b) => b.token.symbol === "PEPE",
    );
    expect(
      toApproxNumber(pepeAfter?.amount ?? fromDecimal("0", 18, "PEPE")),
    ).toBeGreaterThan(8_118_902);
  });

  it("refunds the sell token when a swap fails and rejects expired quotes", async () => {
    jest.useFakeTimers();
    const { dex, wallet } = await setup();
    const bnb = TOKENS.BNB as TokenRef;
    const pepe = TOKENS.PEPE as TokenRef;
    const before = (await wallet.getBalances(ADDRESS, "bsc")).items.find(
      (b) => b.token.symbol === "BNB",
    );
    const quote = await dex.quote({
      chain: "bsc",
      sellToken: bnb,
      buyToken: pepe,
      amountIn: fromDecimal("0.1", 18, "BNB"),
    });
    dex.nextSwapOutcome = "slippage";
    const record = await dex.swap(ADDRESS, quote.id);
    await jest.advanceTimersByTimeAsync(5_000);
    expect((await dex.getSwap(record.id))?.status).toBe("failed");
    const after = (await wallet.getBalances(ADDRESS, "bsc")).items.find(
      (b) => b.token.symbol === "BNB",
    );
    expect(
      toApproxNumber(after?.amount ?? fromDecimal("0", 18, "BNB")),
    ).toBeCloseTo(
      toApproxNumber(before?.amount ?? fromDecimal("0", 18, "BNB")),
      6,
    );
    const stale = await dex.quote({
      chain: "bsc",
      sellToken: bnb,
      buyToken: pepe,
      amountIn: fromDecimal("0.1", 18, "BNB"),
    });
    useMockRuntime.getState().set({ clockOffsetMs: 60_000 });
    await expect(dex.swap(ADDRESS, stale.id)).rejects.toThrow(/expired/);
  });
});
