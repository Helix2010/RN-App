/**
 * 下单金额换算：user-dapp `lib/orderAmounts.ts` 的逐行移植（契约不得改动）。
 *
 * - 市价买（FAK）：价格先向上对齐到 tick，份数由预算向下取整并对齐 0.01 share，
 *   makerAmount = price×shares 精确乘积（永不超出预算）。
 * - 限价买（GTC/GTD）：由预算与价格 ceilDiv 反推 takerAmount 并向上对齐 0.01 share，
 *   再由 price×takerAmount ceilDiv 反推 makerAmount 并向上对齐 usdcUnit。
 * - 卖出：makerAmount 向下对齐 0.01 share，takerAmount = floor(price×maker) 再向下对齐 usdcUnit。
 * - usdcUnit：挂单（GTC/GTD）5 位小数（10），市价（FAK）2 位小数（10_000）。
 * 价格与数量都是 6 位小数的整数（USDC / CTF 份额精度）。
 */

export const PRICE_SCALE = 1_000_000n;

export type OrderAmountSide = "BUY" | "SELL";
export type OrderAmountType = "FAK" | "GTC" | "GTD";

export type OrderAmountsInput = {
  side: OrderAmountSide;
  orderType: OrderAmountType;
  /** 0–1 的价格 */
  price: number;
  /** BUY 传 USDC 金额，SELL 传份数（人类可读） */
  size: number;
  /** 市场 tick（"0.01" / "0.001"），只在市价买用于向上对齐 */
  tickSize?: number;
};

export function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b;
}

export function priceToInt(price: number): bigint {
  return BigInt(Math.round(price * 1_000_000));
}

export function amountToInt(amount: number): bigint {
  return BigInt(Math.round(amount * 1_000_000));
}

/** 市价买价格向上对齐到 tick 格点，保证签名比率精确落格且必然穿价 */
export function alignBuyPriceToTick(price: number, tickSize?: number): bigint {
  const priceInt = priceToInt(price);
  const tickInt = tickSize === 0.001 ? 1_000n : 10_000n;
  return ceilDiv(priceInt, tickInt) * tickInt;
}

export function computeOrderAmounts(input: OrderAmountsInput): {
  makerAmount: bigint;
  takerAmount: bigint;
} {
  const resting = input.orderType === "GTC" || input.orderType === "GTD";
  const shareUnit = 10n ** 4n; // 0.01 share
  const usdcUnit = resting ? 10n : 10_000n; // 0.00001 USDC / 0.01 USDC

  const priceInt =
    input.side === "BUY" && input.orderType === "FAK"
      ? alignBuyPriceToTick(input.price, input.tickSize)
      : priceToInt(input.price);

  if (input.side === "BUY") {
    const sizeUsdc = amountToInt(input.size);
    if (input.orderType === "FAK") {
      const rawTaker = (sizeUsdc * PRICE_SCALE) / priceInt;
      const takerAmount = (rawTaker / shareUnit) * shareUnit;
      const makerAmount = (priceInt * takerAmount) / PRICE_SCALE;
      return { makerAmount, takerAmount };
    }
    const rawTaker = ceilDiv(sizeUsdc * PRICE_SCALE, priceInt);
    const takerAmount = ceilDiv(rawTaker, shareUnit) * shareUnit;
    const rawMaker = ceilDiv(priceInt * takerAmount, PRICE_SCALE);
    const makerAmount = ceilDiv(rawMaker, usdcUnit) * usdcUnit;
    return { makerAmount, takerAmount };
  }

  const sizeTokens = amountToInt(input.size);
  const makerAmount = (sizeTokens / shareUnit) * shareUnit;
  const rawTaker = (priceInt * makerAmount) / PRICE_SCALE;
  const takerAmount = (rawTaker / usdcUnit) * usdcUnit;
  return { makerAmount, takerAmount };
}
