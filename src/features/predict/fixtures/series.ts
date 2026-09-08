import { localized } from "../../../core/i18n/localized-text";
import type { PredictEvent, Series, SeriesPeriod } from "../model/predict";

/** Mock 世界的周期性系列：BTC 5 分钟涨跌，一期一个二元市场 */
export const SERIES: Series[] = [
  {
    id: "series-btc-5m",
    slug: "btc-updown-5m",
    title: localized("BTC 5 分钟涨跌", "BTC Up or Down · 5m"),
    recurrence: "5m",
    seriesType: "recurring",
  },
];

const WINDOW_MS = 5 * 60_000;

function periodEvent(id: string, windowEnd: string, yes: number): PredictEvent {
  const marketId = `m-${id}`;
  return {
    id: `ev-${id}`,
    slug: `btc-updown-5m-${id}`,
    title: localized("BTC 5 分钟涨跌", "BTC Up or Down · 5m"),
    kind: "binary",
    categoryTagId: "crypto",
    category: localized("加密", "Crypto"),
    tagIds: ["crypto"],
    tags: [],
    markets: [
      {
        id: marketId,
        eventId: `ev-${id}`,
        question: localized("BTC 本期收涨？", "Will BTC close up this window?"),
        yesPriceCents: yes,
        volumeUsd: 4_200,
        volume24hUsd: 4_200,
        liquidityUsd: 900,
        endsAt: windowEnd,
        closed: false,
        result: null,
        acceptingOrders: true,
        iconUrl: null,
        yesTokenId: `${marketId}-yes`,
        noTokenId: `${marketId}-no`,
      },
    ],
    volumeUsd: 4_200,
    volume24hUsd: 4_200,
    liquidityUsd: 900,
    closed: false,
    imageUrl: null,
    iconUrl: null,
    endsAt: windowEnd,
    featured: false,
    rules: localized(
      "以 Chainlink BTC/USD 在窗口结束时的价格与窗口开始时的参考价比较。",
      "Compares the Chainlink BTC/USD price at window end against the price to beat.",
    ),
    resolutionSource: localized("Chainlink", "Chainlink"),
    disputeWindowSec: 0,
  };
}

/**
 * 以 nowMs 所在的 5 分钟窗口为当期，向前生成 pastCount 期已结算、向后一期待开。
 * 窗口对齐到整 5 分钟，和平台的 recurrence 一致。
 */
export function seriesPeriods(
  seriesId: string,
  nowMs: number,
  pastCount = 6,
): SeriesPeriod[] {
  const currentStart = Math.floor(nowMs / WINDOW_MS) * WINDOW_MS;
  const periods: SeriesPeriod[] = [];
  for (let offset = -pastCount; offset <= 1; offset += 1) {
    const start = currentStart + offset * WINDOW_MS;
    const end = start + WINDOW_MS;
    const id = `${seriesId}-${start}`;
    const settled = offset < 0;
    const up = ((start / WINDOW_MS) & 1) === 0;
    const priceToBeat = 118_000 + (offset % 4) * 35;
    periods.push({
      id,
      seriesId,
      eventId: `ev-${id}`,
      marketId: `m-${id}`,
      windowStart: new Date(start).toISOString(),
      windowEnd: new Date(end).toISOString(),
      stage: settled ? "settled" : offset === 0 ? "published" : "generated",
      priceToBeat: {
        price: priceToBeat.toFixed(2),
        source: "chainlink",
        sampledAt: new Date(start).toISOString(),
      },
      finalPrice: settled
        ? {
            price: (priceToBeat + (up ? 42 : -37)).toFixed(2),
            source: "chainlink",
            sampledAt: new Date(end).toISOString(),
          }
        : null,
      result: settled ? (up ? "up" : "down") : null,
      event: periodEvent(
        id,
        new Date(end).toISOString(),
        settled ? (up ? 100 : 0) : 52,
      ),
    });
  }
  return periods;
}
