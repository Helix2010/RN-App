import {
  alignBuyPriceToTick,
  amountToInt,
  computeOrderAmounts,
} from "./order-amounts";

describe("computeOrderAmounts (port of user-dapp lib/orderAmounts.ts)", () => {
  it("market buy (FAK): price aligned up to the tick, shares floored to 0.01, maker never exceeds the budget", () => {
    const { makerAmount, takerAmount } = computeOrderAmounts({
      side: "BUY",
      orderType: "FAK",
      price: 0.613,
      size: 10,
      tickSize: 0.01,
    });
    // 0.613 → 对齐到 0.62；10 / 0.62 = 16.129… → 16.12 份
    expect(takerAmount).toBe(16_120_000n);
    // maker = 0.62 × 16.12 = 9.9944，精确乘积，不超过 10 USDC 预算
    expect(makerAmount).toBe(9_994_400n);
    expect(makerAmount <= amountToInt(10)).toBe(true);
    expect(alignBuyPriceToTick(0.613, 0.001)).toBe(613_000n);
    expect(alignBuyPriceToTick(0.6131, 0.001)).toBe(614_000n);
  });

  it("limit buy (GTC): taker ceiled to 0.01 share, maker ceiled to 0.00001 USDC", () => {
    const { makerAmount, takerAmount } = computeOrderAmounts({
      side: "BUY",
      orderType: "GTC",
      price: 0.33,
      size: 10,
    });
    // 10 / 0.33 = 30.3030… → 向上 30.31 份
    expect(takerAmount).toBe(30_310_000n);
    // 0.33 × 30.31 = 10.0023 → 向上到 0.00001
    expect(makerAmount).toBe(10_002_300n);
    expect(makerAmount >= amountToInt(10)).toBe(true);
  });

  it("sell: maker floored to 0.01 share, taker floored to the usdc unit of the order type", () => {
    const resting = computeOrderAmounts({
      side: "SELL",
      orderType: "GTC",
      price: 0.333,
      size: 12.345,
    });
    expect(resting.makerAmount).toBe(12_340_000n);
    // 0.333 × 12.34 = 4.10922 → GTC 精度 0.00001
    expect(resting.takerAmount).toBe(4_109_220n);
    const market = computeOrderAmounts({
      side: "SELL",
      orderType: "FAK",
      price: 0.333,
      size: 12.345,
    });
    // 市价 2 位小数：4.10
    expect(market.takerAmount).toBe(4_100_000n);
  });

  it("returns zero amounts when the size is below one share unit so the caller can refuse", () => {
    const { makerAmount, takerAmount } = computeOrderAmounts({
      side: "SELL",
      orderType: "FAK",
      price: 0.5,
      size: 0.001,
    });
    expect(makerAmount).toBe(0n);
    expect(takerAmount).toBe(0n);
  });
});
