import { fromDecimal } from "../money/money";
import {
  formatCents,
  formatCountdown,
  formatMoney,
  formatPercent,
  formatProbability,
  formatTimeUntil,
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
