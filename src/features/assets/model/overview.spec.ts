import { fromDecimal } from "../../../core/money/money";
import type { ChainId, TokenRef } from "../../../core/gateways/types";
import { composeOverview, type ChainResult } from "./overview";

const token = (chain: ChainId, symbol: string): TokenRef => ({
  chain,
  address: `0x${symbol.toLowerCase().padEnd(40, "0")}`,
  symbol,
  name: symbol,
  decimals: 18,
  displayDecimals: 2,
  logoColor: "#000000",
  verified: false,
});

describe("composeOverview", () => {
  it("lists catalogue tokens with blank amounts for chains that have not answered yet", () => {
    const overview = composeOverview({
      address: "0xabc",
      chains: ["bsc", "eth"],
      catalogue: (chain) => [token(chain, chain === "bsc" ? "BNB" : "ETH")],
      results: (chain): ChainResult =>
        chain === "bsc"
          ? {
              status: "ready",
              snapshot: {
                items: [
                  {
                    token: token("bsc", "BNB"),
                    amount: fromDecimal("2", 18, "BNB"),
                    usdValue: 1200,
                    change24hPct: 10,
                  },
                ],
                unavailable: [],
              },
            }
          : { status: "loading" },
      predict: null,
    });
    expect(overview.rows.map((row) => [row.token.symbol, row.loading])).toEqual(
      [
        ["BNB", false],
        ["ETH", true],
      ],
    );
    expect(overview.loading).toBe(true);
    expect(overview.partial).toBe(true);
    expect(overview.totalUsd).toBe(1200);
    expect(overview.wallet.chains).toBe(1);
  });

  it("ignores rows from other chains that a gateway returned in bulk and adds predict funds to the total", () => {
    const overview = composeOverview({
      address: "0xabc",
      chains: ["bsc"],
      catalogue: () => [],
      results: () => ({
        status: "ready",
        snapshot: {
          items: [
            {
              token: token("eth", "ETH"),
              amount: fromDecimal("1", 18, "ETH"),
              usdValue: 3000,
              change24hPct: 0,
            },
          ],
          unavailable: [{ chain: "eth", reason: "node" }],
        },
      }),
      predict: {
        status: "enabled",
        chain: "bsc",
        usd: 50,
        available: fromDecimal("50", 6, "USDW"),
        lockedInOrders: fromDecimal("0", 6, "USDW"),
        safeBalance: fromDecimal("50", 6, "USDW"),
      },
    });
    expect(overview.rows).toEqual([]);
    expect(overview.unavailable).toEqual([]);
    expect(overview.totalUsd).toBe(50);
    expect(overview.loading).toBe(false);
    expect(overview.partial).toBe(false);
  });

  it("marks a chain whose query threw as failed and keeps its catalogue rows visible but not loading", () => {
    const overview = composeOverview({
      address: "0xabc",
      chains: ["bsc"],
      catalogue: () => [token("bsc", "BNB")],
      results: () => ({ status: "error", error: new Error("boom") }),
      predict: undefined,
    });
    expect(overview.failed).toHaveLength(1);
    expect(overview.rows[0]?.loading).toBe(false);
    expect(overview.rows[0]?.amount).toBeNull();
    // 预测账户还在查：整体仍是加载中
    expect(overview.loading).toBe(true);
  });
});
