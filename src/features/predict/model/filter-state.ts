import type { EventQuery, Series, Tag } from "./predict";

/**
 * 市场列表页的筛选状态（设计 predict-home-filters-2026-09-09 §8）。
 * 一份参数描述整页：首页"查看全部"、榜单、系列卡、深链都用它进入。
 * - `tag` 为 null = 全部（不带标签请求，运营位在这个视图出现）
 * - 选了二级时 `tag` 是二级 id、`parentTag` 是一级 id；只选一级时两者相同
 */
export type Filters = {
  tag: string | null;
  parentTag: string | null;
  view: NonNullable<EventQuery["status"]>;
  sort: NonNullable<EventQuery["sort"]>;
  q: string;
  favorites: boolean;
};

export const DEFAULT_FILTERS: Filters = {
  tag: null,
  parentTag: null,
  view: "trading",
  sort: "volume",
  q: "",
  favorites: false,
};

export const VIEW_OPTIONS: Filters["view"][] = ["trading", "closed", "all"];
export const SORT_OPTIONS: Filters["sort"][] = [
  "volume",
  "volume24h",
  "liquidity",
  "endingSoon",
  "newest",
];

/** 切一级：二级重置、退出搜索与收藏，视图 / 排序保留 */
export function selectPrimary(filters: Filters, tagId: string | null): Filters {
  return { ...filters, tag: tagId, parentTag: tagId, q: "", favorites: false };
}

/** 切二级：null = 回到"全部 <一级>" */
export function selectSecondary(
  filters: Filters,
  childId: string | null,
): Filters {
  return { ...filters, tag: childId ?? filters.parentTag };
}

/** 运营位（精选 / 榜单）只在全站 · 交易中 · 未搜索 · 非收藏视图出现 */
export function isDiscovery(filters: Filters): boolean {
  return (
    filters.tag === null &&
    filters.view === "trading" &&
    !filters.favorites &&
    filters.q.trim() === ""
  );
}

/** 周期市场系列卡：全部视图和 crypto 一级（含其二级）下显示 */
export function showSeriesFor(
  filters: Filters,
  primary: Tag | undefined,
): boolean {
  return (
    filters.view === "trading" &&
    !filters.favorites &&
    filters.q.trim() === "" &&
    (filters.tag === null || primary?.slug === "crypto")
  );
}

const normalize = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

/** crypto 的二级标签是周期粒度（5m / 15m / 1h / 4h / daily）：按 recurrence 匹配系列 */
export function seriesMatchesTag(series: Series, tagSlug: string): boolean {
  const slug = normalize(tagSlug);
  const recurrence = normalize(series.recurrence);
  if (slug === recurrence) return true;
  const daily = new Set(["daily", "1d", "24h"]);
  return daily.has(slug) && daily.has(recurrence);
}

/** 非默认的视图 / 排序拼成"已筛选"提示；都是默认值时返回 null */
export function activeFilterSummary(
  filters: Filters,
  labels: {
    view: (view: Filters["view"]) => string;
    sort: (sort: Filters["sort"]) => string;
  },
): string | null {
  const parts: string[] = [];
  if (filters.view !== DEFAULT_FILTERS.view)
    parts.push(labels.view(filters.view));
  if (filters.sort !== DEFAULT_FILTERS.sort)
    parts.push(labels.sort(filters.sort));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** 一级行内联的轮播标签上限：8 个 ≈ 375 宽两屏，"更多 ▾" 在一次横滑内可见（设计 §4.1 修订） */
export const PRIMARY_INLINE_LIMIT = 8;

/**
 * 一级轮播标签拆成"行内"与"更多"两段，保持平台 carousel_sort 顺序。
 * 溢出只有 1 个时不值得一个面板：不超过 limit + 1 就全部内联，"更多"不出现。
 */
export function splitPrimaryTags<T>(
  tags: T[],
  limit = PRIMARY_INLINE_LIMIT,
): { inline: T[]; overflow: T[] } {
  if (tags.length <= limit + 1) return { inline: tags, overflow: [] };
  return { inline: tags.slice(0, limit), overflow: tags.slice(limit) };
}
