import { fromDecimal, money } from "../money/money";
import {
  formatCents,
  formatCountdown,
  formatMoney,
  formatPercent,
  formatProbability,
  formatTimeUntil,
  formatTokenAmount,
  formatTokenPrice,
  shortenAddress,
  splitLeadingZeros,
} from "./format";
import { pickTranslation } from "./localized-text";

describe("format helpers", () => {
  it("formats prediction prices and probabilities", () => {
    expect(formatCents(62)).toBe("62¢");
    expect(formatCents(61.5)).toBe("61.5¢");
    expect(formatProbability(0.624)).toBe("62%");
  });

  it("formats token prices with enough significant digits", () => {
    expect(formatTokenPrice("0.00001234", "en-US")).toBe("$0.00001234");
    expect(splitLeadingZeros("$0.00001234")).toEqual({
      head: "$0.0000",
      tail: "1234",
    });
    expect(splitLeadingZeros("$1.84")).toEqual({ head: "$1.84", tail: "" });
    expect(formatTokenPrice("1.842", "en-US")).toBe("$1.84");
  });

  it("formats Money with locale grouping", () => {
    expect(formatMoney(fromDecimal("1240.5", 6, "USDC"), "en-US")).toBe(
      "1,240.50 USDC",
    );
    expect(
      formatMoney(fromDecimal("0.000123", 18, "ETH"), "en-US", {
        withSymbol: false,
      }),
    ).toBe("0.000123");
  });

  it("formats percent with explicit sign", () => {
    expect(formatPercent(12.4, "en-US", { sign: true })).toBe("+12.40%");
    expect(formatPercent(-3.8, "en-US", { sign: true, digits: 1 })).toBe(
      "-3.8%",
    );
  });

  it("formats countdown and relative deadlines", () => {
    const now = Date.parse("2026-08-30T00:00:00Z");
    expect(formatCountdown("2026-08-30T21:14:38Z", now)).toBe("21:14:38");
    expect(formatTimeUntil("2026-08-31T04:00:00Z", now, "zh-CN")).toBe(
      "1 天 4 小时后",
    );
    expect(formatTimeUntil("2026-08-29T00:00:00Z", now, "zh-CN")).toBe("");
  });

  it("shortens addresses and picks translations with fallback", () => {
    expect(shortenAddress("0x3f4a8c21b7d94e0a1f6c5d2e8b9a7c3d4e5f9a2c")).toBe(
      "0x3f4a…9a2c",
    );
    expect(pickTranslation({ "zh-CN": "加密", en: "Crypto" }, "zh-CN")).toBe(
      "加密",
    );
    expect(pickTranslation({ zh_CN: "加密", en: "Crypto" }, "zh-CN")).toBe(
      "加密",
    );
    expect(pickTranslation({ en: "Crypto" }, "zh-CN")).toBe("Crypto");
    expect(pickTranslation(undefined, "zh-CN")).toBe("");
  });
});

describe("formatTokenAmount", () => {
  it("truncates to the display precision instead of rounding", () => {
    // 四舍五入会把 0.999 显示成 1.00，而 1 个转不出
    expect(
      formatTokenAmount(fromDecimal("0.999", 18, "USDT"), 2, "en-US"),
    ).toBe("0.99 USDT");
    expect(
      formatTokenAmount(fromDecimal("1234567.89999", 18, "USDT"), 2, "en-US"),
    ).toBe("1,234,567.89 USDT");
    expect(
      formatTokenAmount(fromDecimal("1234567.89999", 18, "USDT"), 2, "zh-CN"),
    ).toBe("1,234,567.89 USDT");
    // 末尾的 0 不保留；0 就是 0
    expect(formatTokenAmount(fromDecimal("100", 18, "USDT"), 2, "en-US")).toBe(
      "100 USDT",
    );
    expect(formatTokenAmount(fromDecimal("0", 18, "USDT"), 2, "en-US")).toBe(
      "0 USDT",
    );
    expect(
      formatTokenAmount(fromDecimal("0.5", 18, "BNB"), 4, "en-US", {
        withSymbol: false,
      }),
    ).toBe("0.5");
  });

  it("says '< one display unit' for dust instead of showing zero", () => {
    expect(
      formatTokenAmount(fromDecimal("0.001", 18, "USDT"), 2, "en-US"),
    ).toBe("< 0.01 USDT");
    // 手续费 0.00003 BNB 按 4 位截成 0，显示成 0 会让用户以为不要钱
    expect(
      formatTokenAmount(money(30_000_000_000_000n, 18, "BNB"), 4, "en-US"),
    ).toBe("< 0.0001 BNB");
    expect(formatTokenAmount(money(1n, 18, "BNB"), 0, "en-US")).toBe("< 1 BNB");
    expect(formatTokenAmount(money(-1n, 18, "BNB"), 4, "en-US")).toBe(
      "> -0.0001 BNB",
    );
  });

  it("never shows more digits than the chain has, and keeps bigint precision", () => {
    // 展示精度大于链上精度时夹到链上精度
    expect(formatTokenAmount(money(1234567n, 6, "USDC"), 8, "en-US")).toBe(
      "1.234567 USDC",
    );
    // 整数位超过 Number 的安全范围也一位不丢
    expect(
      formatTokenAmount(
        money(123456789012345678901234n, 6, "PEPE"),
        2,
        "en-US",
      ),
    ).toBe("123,456,789,012,345,678.9 PEPE");
    expect(formatTokenAmount(money(-1500000n, 6, "USDC"), 2, "en-US")).toBe(
      "-1.5 USDC",
    );
  });
});
