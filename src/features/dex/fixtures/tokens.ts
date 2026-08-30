import { localized } from "../../../core/i18n/localized-text";
import { TOKENS } from "../../wallet/fixtures/wallet";
import type { SecurityReport, TokenSummary } from "../model/dex";

const ok: SecurityReport = {
  openSource: true,
  mintable: false,
  buyTaxBps: 0,
  sellTaxBps: 0,
  top10Pct: 18,
  honeypot: false,
  passed: 4,
  total: 4,
};

function spark(seedValues: number[]): number[] {
  return seedValues;
}

export const TOKEN_SUMMARIES: TokenSummary[] = [
  {
    token: TOKENS.PEPE as NonNullable<(typeof TOKENS)["PEPE"]>,
    priceUsd: "0.00001234",
    change24hPct: 12.4,
    mcapUsd: 5_100_000_000,
    liquidityUsd: 4_200_000,
    volume24hUsd: 38_600_000,
    holders: 128_400,
    sparkline: spark([1, 1.02, 1.01, 1.06, 1.05, 1.1, 1.09, 1.12, 1.13]),
    listedAt: "2023-04-14T00:00:00Z",
    isNew: false,
  },
  {
    token: TOKENS.AERO as NonNullable<(typeof TOKENS)["AERO"]>,
    priceUsd: "0.912",
    change24hPct: 5.1,
    mcapUsd: 820_000_000,
    liquidityUsd: 28_400_000,
    volume24hUsd: 12_100_000,
    holders: 61_200,
    sparkline: spark([1, 1.01, 1.0, 1.03, 1.02, 1.04, 1.04, 1.06, 1.05]),
    listedAt: "2023-08-28T00:00:00Z",
    isNew: false,
  },
  {
    token: TOKENS.CAKE as NonNullable<(typeof TOKENS)["CAKE"]>,
    priceUsd: "2.84",
    change24hPct: 2.2,
    mcapUsd: 980_000_000,
    liquidityUsd: 31_000_000,
    volume24hUsd: 9_800_000,
    holders: 1_420_000,
    sparkline: spark([1, 1.0, 1.01, 1.0, 1.02, 1.01, 1.02, 1.02, 1.02]),
    listedAt: "2020-09-29T00:00:00Z",
    isNew: false,
  },
  {
    token: TOKENS.UNI as NonNullable<(typeof TOKENS)["UNI"]>,
    priceUsd: "10.62",
    change24hPct: -0.6,
    mcapUsd: 6_400_000_000,
    liquidityUsd: 52_100_000,
    volume24hUsd: 84_000_000,
    holders: 380_000,
    sparkline: spark([1, 1.0, 0.99, 1.0, 0.99, 1.0, 0.99, 0.99, 0.994]),
    listedAt: "2020-09-16T00:00:00Z",
    isNew: false,
  },
  {
    token: TOKENS.ZORA as NonNullable<(typeof TOKENS)["ZORA"]>,
    priceUsd: "0.0412",
    change24hPct: 186,
    mcapUsd: 41_000_000,
    liquidityUsd: 620_000,
    volume24hUsd: 3_900_000,
    holders: 4_100,
    sparkline: spark([1, 1.1, 1.3, 1.25, 1.8, 2.1, 2.4, 2.7, 2.86]),
    listedAt: "2026-08-30T10:00:00Z",
    isNew: true,
  },
  {
    token: TOKENS.MOG as NonNullable<(typeof TOKENS)["MOG"]>,
    priceUsd: "0.0000018",
    change24hPct: -22,
    mcapUsd: 720_000_000,
    liquidityUsd: 6_300_000,
    volume24hUsd: 15_200_000,
    holders: 88_000,
    sparkline: spark([1, 0.97, 0.95, 0.9, 0.88, 0.84, 0.8, 0.79, 0.78]),
    listedAt: "2026-08-30T07:00:00Z",
    isNew: true,
  },
];

export const SECURITY: Record<string, SecurityReport> = {
  PEPE: ok,
  AERO: ok,
  CAKE: ok,
  UNI: ok,
  ZORA: { ...ok, top10Pct: 41, passed: 3 },
  MOG: {
    openSource: true,
    mintable: true,
    buyTaxBps: 300,
    sellTaxBps: 300,
    top10Pct: 52,
    honeypot: false,
    passed: 1,
    total: 4,
  },
};

export const DESCRIPTIONS: Record<string, ReturnType<typeof localized>> = {
  PEPE: localized(
    "以青蛙 Pepe 为主题的 meme 币，在 BSC 上流动性最深的 meme 之一。",
    "Frog-themed meme coin; one of the deepest meme liquidity pools on BSC.",
  ),
  AERO: localized(
    "Base 链上的 ve(3,3) 流动性协议治理代币。",
    "Governance token of the ve(3,3) liquidity hub on Base.",
  ),
};
