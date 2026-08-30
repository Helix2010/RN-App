import {
  add,
  compare,
  fromDecimal,
  money,
  scaleBps,
  scaleRatio,
  sub,
  toDecimalString,
} from "./money";

describe("Money", () => {
  it("parses decimals without floating point drift", () => {
    expect(fromDecimal("12.5", 6, "USDC").raw).toBe("12500000");
    expect(fromDecimal("0.1", 18, "ETH").raw).toBe("100000000000000000");
    expect(fromDecimal("1,240.50", 6, "USDC").raw).toBe("1240500000");
    expect(fromDecimal("-3", 2, "X").raw).toBe("-300");
  });

  it("formats back to decimal strings", () => {
    expect(toDecimalString(money("1240500000", 6, "USDC"))).toBe("1240.5");
    expect(toDecimalString(money("100", 6, "USDC"))).toBe("0.0001");
    expect(toDecimalString(money("123456789", 6, "USDC"), 2)).toBe("123.45");
    expect(toDecimalString(money("-1500000", 6, "USDC"))).toBe("-1.5");
  });

  it("adds, subtracts and compares same-denomination values", () => {
    const a = fromDecimal("1", 6, "USDC");
    const b = fromDecimal("0.25", 6, "USDC");
    expect(toDecimalString(add(a, b))).toBe("1.25");
    expect(toDecimalString(sub(a, b))).toBe("0.75");
    expect(compare(a, b)).toBe(1);
    expect(() => add(a, fromDecimal("1", 18, "ETH"))).toThrow(/mismatch/);
  });

  it("applies bps and ratio scaling with rounding", () => {
    const amount = fromDecimal("100", 6, "USDC");
    expect(toDecimalString(scaleBps(amount, 20))).toBe("0.2");
    expect(toDecimalString(scaleRatio(amount, 100n, 62n), 4)).toBe("161.2903");
    expect(() => scaleBps(amount, -1)).toThrow();
  });
});
