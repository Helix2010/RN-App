import { z } from "zod";
import type { PredictServiceConfig } from "../config/bootstrap.schema";
import type { LocalizedText } from "../i18n/localized-text";
import { platformHosts, platformRequest } from "./tenant-client";

/**
 * gamma-service 的公开行情接口（只需租户头）。
 *
 * 字段与 user-dapp 的 `types/polymarket.ts` 一致；查询参数照 `lib/api/gamma.ts`。
 * `outcomes / outcomePrices / clobTokenIds` 平台可能给数组也可能给 JSON 字符串
 * （`lib/api/adapters.ts:214-224`），这里统一成数组；多语言字段是按语言分键的 JSON 串，
 * 统一成 `LocalizedText`（与 `pickTranslation` 的回退链一致）。
 */

/** 数值字段平台有时给字符串 */
const num = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((value) => {
    if (value === null || value === undefined) return null;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  });

const jsonArray = z.unknown().transform((raw): string[] => {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
});

/** 按语言分键的 JSON 串 → LocalizedText；`fallback` 是平台的原文（英文） */
export function translationOf(
  raw: string | null | undefined,
  fallback: string | null | undefined,
): LocalizedText {
  const text: LocalizedText = {};
  if (fallback) text.default = fallback;
  if (!raw) return text;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(
        parsed as Record<string, unknown>,
      )) {
        if (typeof value === "string" && value.trim() !== "")
          text[key.replace(/_/g, "-")] = value.trim();
      }
    }
  } catch {
    // 不是 JSON 就当没有翻译，原文兜住的是"平台给了什么就显示什么"，不是编数据
  }
  return text;
}

const gammaTagSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  label: z.string().nullish(),
  labelTranslation: z.string().nullish(),
  slug: z.string().nullish(),
  isCarousel: z.boolean().nullish(),
  tagType: z.string().nullish(),
});
export type GammaTag = z.infer<typeof gammaTagSchema>;

const gammaAdjudicationSchema = z.object({
  status: z.string(),
  settledOutcome: z.string().nullish(),
  resolvedAt: z.string().nullish(),
  proposedOutcome: z.string().nullish(),
  proposedAt: z.string().nullish(),
  challenger: z.string().nullish(),
  challengedAt: z.string().nullish(),
  livenessDeadline: z.string().nullish(),
  livenessSecs: z.number().nullish(),
  currentPhase: z.string().nullish(),
  // 争议要用的链上参数（gamma models.go:228-259）：适配器实例名、LightOracle 请求的 ancillaryData
  // 与 requestTimestamp；bond 不在接口里，客户端读链
  adapterInstance: z.string().nullish(),
  ancillaryData: z.string().nullish(),
  requestTimestamp: z.union([z.string(), z.number()]).nullish(),
  questionId: z.string().nullish(),
  nextSteps: z.unknown().nullish(),
});

export const gammaMarketSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  conditionId: z.string(),
  question: z.string().nullish(),
  questionTranslation: z.string().nullish(),
  groupItemTitle: z.string().nullish(),
  slug: z.string().nullish(),
  outcomes: jsonArray,
  outcomePrices: jsonArray,
  clobTokenIds: jsonArray,
  description: z.string().nullish(),
  image: z.string().nullish(),
  icon: z.string().nullish(),
  volume: num,
  volume24hr: num,
  liquidity: num,
  oneDayPriceChange: num,
  endDate: z.string().nullish(),
  active: z.boolean().nullish(),
  closed: z.boolean().nullish(),
  acceptingOrders: z.boolean().nullish(),
  orderMinSize: num,
  lastTradePrice: num,
  bestBid: num,
  bestAsk: num,
  negRisk: z.boolean().nullish(),
  adjudication: gammaAdjudicationSchema.nullish(),
});
export type GammaMarket = z.infer<typeof gammaMarketSchema>;

const gammaEventSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  slug: z.string().nullish(),
  title: z.string().nullish(),
  titleTranslation: z.string().nullish(),
  description: z.string().nullish(),
  resolutionSource: z.string().nullish(),
  endDate: z.string().nullish(),
  active: z.boolean().nullish(),
  closed: z.boolean().nullish(),
  featured: z.boolean().nullish(),
  volume: num,
  volume24hr: num,
  liquidity: num,
  negRisk: z.boolean().nullish(),
  numMarkets: num,
  image: z.string().nullish(),
  icon: z.string().nullish(),
  // /curation/events 的位次字段（user-dapp HomepageCurationSection.tsx）：
  // featuredLevel 是位掩码 normal=1 / highlight=2 / hero=4，各区各有自己的顺序号
  featuredLevel: num,
  featuredOrder: num,
  featuredOrderHero: num,
  featuredOrderHighlight: num,
  featuredOrderNormal: num,
  markets: z.array(gammaMarketSchema).nullish(),
  tags: z.array(gammaTagSchema).nullish(),
});
export type GammaEvent = z.infer<typeof gammaEventSchema>;

const gammaSeriesSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  slug: z.string(),
  title: z.string().nullish(),
  titleTranslation: z.string().nullish(),
  seriesType: z.string().nullish(),
  recurrence: z.string().nullish(),
  active: z.boolean().nullish(),
  closed: z.boolean().nullish(),
  /** 标的代号（如 BTCUSD），实时价与 K 线按它订阅 */
  ticker: z.string().nullish(),
});
export type GammaSeries = z.infer<typeof gammaSeriesSchema>;

const gammaSeriesPeriodPriceSchema = z.object({
  price: z.union([z.string(), z.number()]).transform(String),
  source: z.string().nullish(),
  sampledAt: z.string().nullish(),
});
const gammaSeriesPeriodSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  seriesId: z.union([z.string(), z.number()]).transform(String),
  eventId: z.union([z.string(), z.number()]).transform(String),
  marketId: z.union([z.string(), z.number()]).nullish(),
  windowStart: z.string(),
  windowEnd: z.string(),
  stage: z.string().nullish(),
  priceToBeat: gammaSeriesPeriodPriceSchema.nullish(),
  finalPrice: gammaSeriesPeriodPriceSchema.nullish(),
  // 结果只有涨 / 跌两种；别的值说明契约变了，让 schema 直接报错而不是悄悄当作待结算
  result: z.enum(["up", "down"]).nullish(),
  /** 上游对该期声明的结算取价源（如 chainlink twap-60s 流）；实时价按它选流，与结算同源 */
  resolutionSource: z.string().nullish(),
  event: gammaEventSchema.nullish(),
});
export type GammaSeriesPeriod = z.infer<typeof gammaSeriesPeriodSchema>;

type GammaEventsQuery = {
  tagId?: string;
  /** 与 user-dapp 一致：volume / volume24hr 降序、end_date_iso 升序、created_at 降序 */
  order?: "volume" | "volume24hr" | "end_date_iso" | "created_at";
  /** trading = active 且未 closed（默认）；closed = 已截止；all = 不按状态过滤 */
  status?: "trading" | "closed" | "all";
  /** 选了一级标签时把子标签（related-tags）下的事件一并算进来 */
  relatedTags?: boolean;
  limit: number;
  offset: number;
};

function query(params: Record<string, string | number | boolean | undefined>) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) qs.set(key, String(value));
  const text = qs.toString();
  return text ? `?${text}` : "";
}

/** 首页分类标签（与 user-dapp `useTags.ts` 同参数） */
export async function fetchCarouselTags(
  service: PredictServiceConfig,
): Promise<GammaTag[]> {
  const hosts = platformHosts(service);
  return platformRequest({
    url: `${hosts.gamma}/tags${query({ is_carousel: true, order: "carousel_sort", ascending: true })}`,
    tenantDomain: service.domain,
    schema: z.array(gammaTagSchema),
  });
}

/** 事件列表：只要在交易中的（active、未 closed），排除周期单期 event */
export async function fetchEvents(
  service: PredictServiceConfig,
  input: GammaEventsQuery,
): Promise<GammaEvent[]> {
  const hosts = platformHosts(service);
  const order = input.order ?? "volume";
  return platformRequest({
    url: `${hosts.gamma}/events${query({
      ...(input.status === "all"
        ? {}
        : input.status === "closed"
          ? { closed: true }
          : { active: true, closed: false }),
      limit: input.limit,
      offset: input.offset,
      order,
      ascending: order === "end_date_iso",
      tag_id: input.tagId,
      related_tags: input.relatedTags ? true : undefined,
      exclude_tag_slug: "recurring",
    })}`,
    tenantDomain: service.domain,
    schema: z.array(gammaEventSchema),
  });
}

/** 标签全集（"更多分类"面板）：按名称排序，一次取完（dev 上 188 个） */
export async function fetchAllTags(
  service: PredictServiceConfig,
): Promise<GammaTag[]> {
  const hosts = platformHosts(service);
  return platformRequest({
    url: `${hosts.gamma}/tags${query({ limit: 500, order: "label", ascending: true })}`,
    tenantDomain: service.domain,
    schema: z.array(gammaTagSchema),
  });
}

/** 一级标签下的二级标签（网页版 `getRelatedTags`）；没有子标签就是空数组 */
export async function fetchRelatedTags(
  service: PredictServiceConfig,
  tagId: string,
): Promise<GammaTag[]> {
  const hosts = platformHosts(service);
  return platformRequest({
    url: `${hosts.gamma}/tags/${encodeURIComponent(tagId)}/related-tags/tags`,
    tenantDomain: service.domain,
    schema: z.array(gammaTagSchema),
  });
}

const gammaPublicSearchSchema = z.object({
  events: z.array(gammaEventSchema).nullish(),
  tags: z.array(gammaTagSchema).nullish(),
  pagination: z
    .object({
      hasMore: z.boolean().nullish(),
      totalResults: z.number().nullish(),
    })
    .nullish(),
});
export type GammaPublicSearch = z.infer<typeof gammaPublicSearchSchema>;

/** 全站搜索（gamma `/public-search`，网页版全局搜索框用的同一个接口）；page 从 1 起 */
export async function fetchPublicSearch(
  service: PredictServiceConfig,
  input: { q: string; status: "trading" | "closed" | "all"; page: number },
): Promise<GammaPublicSearch> {
  const hosts = platformHosts(service);
  return platformRequest({
    url: `${hosts.gamma}/public-search${query({
      q: input.q,
      limit_per_type: 20,
      events_status:
        input.status === "trading"
          ? "active"
          : input.status === "closed"
            ? "closed"
            : undefined,
      page: input.page,
    })}`,
    tenantDomain: service.domain,
    schema: gammaPublicSearchSchema,
  });
}

/** 按 slug 或数字 id 取事件 */
export async function fetchEvent(
  service: PredictServiceConfig,
  slugOrId: string,
): Promise<GammaEvent> {
  const hosts = platformHosts(service);
  const path = /^\d+$/.test(slugOrId)
    ? `/events/${slugOrId}`
    : `/events/slug/${encodeURIComponent(slugOrId)}`;
  return platformRequest({
    url: `${hosts.gamma}${path}`,
    tenantDomain: service.domain,
    schema: gammaEventSchema,
  });
}

/**
 * 争议证据意向（网页 RaiseDisputeModal 第 0 步）：链上争议之前先把理由与链接登记到平台，
 * indexer 看到 `PriceDisputed` 后按 (conditionId, disputer) 关联。接口无鉴权（review §4.3）。
 * 4xx：400 校验不过、404 未知条件、409 不在 proposed 或本轮已有争议。
 */
export async function postDisputeEvidence(
  service: PredictServiceConfig,
  input: {
    conditionId: string;
    disputer: string;
    evidence: string;
    links: string[];
  },
): Promise<{ evidenceId: string }> {
  const hosts = platformHosts(service);
  return platformRequest({
    url: `${hosts.gamma}/disputes/evidence`,
    tenantDomain: service.domain,
    method: "POST",
    body: input,
    schema: z.object({
      evidenceId: z.union([z.string(), z.number()]).transform(String),
    }),
  });
}

/** 按 conditionId 反查市场（持仓 → 事件） */
export async function fetchMarketsByCondition(
  service: PredictServiceConfig,
  conditionIds: string[],
): Promise<(GammaMarket & { eventSlug?: string | null })[]> {
  if (conditionIds.length === 0) return [];
  const hosts = platformHosts(service);
  return platformRequest({
    url: `${hosts.gamma}/markets/information`,
    tenantDomain: service.domain,
    method: "POST",
    body: { conditionIds },
    schema: z.array(
      gammaMarketSchema.extend({ eventSlug: z.string().nullish() }),
    ),
  });
}

/** 首页策展位（user-dapp `getCurationEvents`）：运营手工排的英雄 / 高亮 / 普通三区 */
export async function fetchCuratedEvents(
  service: PredictServiceConfig,
): Promise<GammaEvent[]> {
  const hosts = platformHosts(service);
  return platformRequest({
    url: `${hosts.gamma}/curation/events`,
    tenantDomain: service.domain,
    schema: z.array(gammaEventSchema),
  });
}

/** 周期性系列列表（user-dapp `useHomepageCategoryMarkets` 同参数，不带事件） */
export async function fetchSeriesList(
  service: PredictServiceConfig,
  input: { limit: number } = { limit: 20 },
): Promise<GammaSeries[]> {
  const hosts = platformHosts(service);
  return platformRequest({
    url: `${hosts.gamma}/series${query({
      closed: false,
      exclude_events: true,
      limit: input.limit,
      offset: 0,
      order: "id",
      ascending: false,
    })}`,
    tenantDomain: service.domain,
    schema: z.array(gammaSeriesSchema),
  });
}

/** 按 slug 取系列；带 `series_id` 定位（网页版 gamma.ts:267-295：只按 slug 可能打开同名的另一个系列） */
export async function fetchSeries(
  service: PredictServiceConfig,
  slug: string,
  seriesId?: string,
): Promise<GammaSeries> {
  const hosts = platformHosts(service);
  return platformRequest({
    url: `${hosts.gamma}/series/slug/${encodeURIComponent(slug)}${query({ exclude_events: true, series_id: seriesId })}`,
    tenantDomain: service.domain,
    schema: gammaSeriesSchema,
  });
}

/**
 * 系列分期（本平台扩展 `GET /series/{id}/periods`）：
 * current=true 取近场切片（含当期与下一期），closed=true 取已结束的历史分期。
 */
export async function fetchSeriesPeriods(
  service: PredictServiceConfig,
  seriesId: string,
  input: { scope: "current" | "closed"; limit: number; cursor?: string },
): Promise<{ data: GammaSeriesPeriod[]; nextCursor: string | null }> {
  const hosts = platformHosts(service);
  const response = await platformRequest({
    url: `${hosts.gamma}/series/${encodeURIComponent(seriesId)}/periods${query(
      input.scope === "current"
        ? { current: true, limit: input.limit }
        : { closed: true, limit: input.limit, cursor: input.cursor },
    )}`,
    tenantDomain: service.domain,
    schema: z.object({
      data: z.array(gammaSeriesPeriodSchema),
      nextCursor: z.string().nullish(),
    }),
  });
  return { data: response.data, nextCursor: response.nextCursor ?? null };
}

/**
 * 可成交价：0 < p < 1。网页版 adapters.ts:566-567 / orderbookPricing.ts isTradablePrice 同规则；
 * gamma 用 0 表示没数据，1 也不是概率。
 */
export function tradablePrice(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && value > 0 && value < 1
    ? value
    : null;
}

/**
 * 展示价：`(bestBid+bestAsk)/2`，缺一取另一个，都缺取最新成交价（`marketSorting.ts:23-30`）。
 * 都没有返回 null，不编一个 0.5。
 */
export function displayPrice(market: GammaMarket): number | null {
  const valid = tradablePrice;
  const bid = valid(market.bestBid);
  const ask = valid(market.bestAsk);
  if (bid !== null && ask !== null) return (bid + ask) / 2;
  if (ask !== null) return ask;
  if (bid !== null) return bid;
  return valid(market.lastTradePrice);
}
