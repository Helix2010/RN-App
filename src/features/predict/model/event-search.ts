import type { LocalizedText } from "../../../core/i18n/localized-text";
import type { CuratedEvent, PredictEvent } from "./predict";

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

/** 事件里最高的 Yes 价（分）；所有市场都没报价时为 null */
export function topYesCents(event: PredictEvent): number | null {
  const cents = Math.max(
    -1,
    ...event.markets.map((market) => market.yesPriceCents ?? -1),
  );
  return cents >= 0 ? cents : null;
}

/** 概率榜：每个事件取其最高 Yes 价，按高到低排 */
export function topByProbability(
  events: PredictEvent[],
  limit = 3,
): { event: PredictEvent; cents: number }[] {
  return events
    .map((event) => ({ event, cents: topYesCents(event) ?? -1 }))
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

/**
 * 策展分区：按运营给的位次升序（网页版 HomepageCurationSection `orderForZone`，同位次按 id 升序），
 * hero 进轮播，highlight 是"热门精选"，normal 是"突发"。
 */
export function curationZone(
  items: CuratedEvent[],
  zone: "hero" | "highlight" | "normal",
  limit = Number.POSITIVE_INFINITY,
): PredictEvent[] {
  return items
    .filter((item) => item[zone] !== null)
    .sort(
      (a, b) =>
        (a[zone] as number) - (b[zone] as number) ||
        a.event.id.localeCompare(b.event.id, undefined, { numeric: true }),
    )
    .slice(0, limit)
    .map((item) => item.event);
}

/** 榜单区块的四个 tab；顺序就是去重优先级 */
export type RankKey = "hotPicks" | "breaking" | "topProbability" | "topToday";
export const RANK_KEYS: RankKey[] = [
  "hotPicks",
  "breaking",
  "topProbability",
  "topToday",
];

export type RankBoard = { key: RankKey; events: PredictEvent[] };

/**
 * 榜单去重（设计 predict-discovery-polish §4）：进了精选轮播的事件不再进任何榜；
 * 一个事件只出现在优先级最高的榜里（运营位 highlight > normal > 本地 高概率 > 今日热门）；
 * 每榜最多 limit 行；空榜不返回。
 */
export function buildRankBoards(
  input: {
    heroIds: ReadonlySet<string>;
    hotPicks: PredictEvent[];
    breaking: PredictEvent[];
    topProbability: PredictEvent[];
    topToday: PredictEvent[];
  },
  limit = 5,
): RankBoard[] {
  const taken = new Set<string>(input.heroIds);
  const boards: RankBoard[] = [];
  for (const key of RANK_KEYS) {
    const events: PredictEvent[] = [];
    for (const event of input[key]) {
      if (events.length >= limit) break;
      if (taken.has(event.id)) continue;
      taken.add(event.id);
      events.push(event);
    }
    if (events.length > 0) boards.push({ key, events });
  }
  return boards;
}
