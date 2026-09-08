import type { LocalizedText } from "../../../core/i18n/localized-text";
import type { PredictEvent } from "./predict";

function texts(value: LocalizedText | undefined | null): string[] {
  if (!value) return [];
  return Object.values(value).filter(
    (text): text is string => typeof text === "string" && text.length > 0,
  );
}

/**
 * 本地搜索（与网页版 `MarketList.tsx` 一样只在已加载的列表里过滤，平台没有搜索参数）。
 * 匹配事件标题、分类、每个结果的问题与选项名，任一语言命中即算。
 */
export function matchesEventSearch(
  event: PredictEvent,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    ...texts(event.title),
    ...texts(event.category),
    ...event.tags.flatMap((tag) => texts(tag.label)),
    ...event.markets.flatMap((market) => [
      ...texts(market.question),
      ...texts(market.outcomeLabel),
    ]),
  ];
  return haystack.some((text) => text.toLowerCase().includes(needle));
}

/** 概率榜：每个事件取其最高 Yes 价，按高到低排 */
export function topByProbability(
  events: PredictEvent[],
  limit = 3,
): { event: PredictEvent; cents: number }[] {
  return events
    .map((event) => ({
      event,
      cents: Math.max(
        -1,
        ...event.markets.map((market) => market.yesPriceCents ?? -1),
      ),
    }))
    .filter((item) => item.cents >= 0)
    .sort((a, b) => b.cents - a.cents)
    .slice(0, limit);
}

/** 今日热门：按近 24h 成交量排，没有 24h 成交的不进榜 */
export function topByVolume24h(
  events: PredictEvent[],
  limit = 3,
): PredictEvent[] {
  return events
    .filter((event) => event.volume24hUsd > 0)
    .sort((a, b) => b.volume24hUsd - a.volume24hUsd)
    .slice(0, limit);
}
