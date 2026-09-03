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
  volume: num,
  volume24hr: num,
  liquidity: num,
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
  markets: z.array(gammaMarketSchema).nullish(),
  tags: z.array(gammaTagSchema).nullish(),
});
export type GammaEvent = z.infer<typeof gammaEventSchema>;

type GammaEventsQuery = {
  tagId?: string;
  featured?: boolean;
  /** 与 user-dapp 一致：volume 降序、end_date_iso 升序、created_at 降序 */
  order?: "volume" | "end_date_iso" | "created_at";
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
      active: true,
      closed: false,
      limit: input.limit,
      offset: input.offset,
      order,
      ascending: order === "end_date_iso",
      tag_id: input.tagId,
      featured: input.featured,
      exclude_tag_slug: "recurring",
    })}`,
    tenantDomain: service.domain,
    schema: z.array(gammaEventSchema),
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

/**
 * 展示价：`(bestBid+bestAsk)/2`，缺一取另一个，都缺取最新成交价（`marketSorting.ts:23-30`）。
 * 都没有返回 null，不编一个 0.5。
 */
/**
 * 可成交价：0 < p < 1。网页版 adapters.ts:566-567 / orderbookPricing.ts isTradablePrice 同规则；
 * gamma 用 0 表示没数据，1 也不是概率。
 */
export function tradablePrice(value: number | null | undefined): number | null {
  return value !== null && value !== undefined && value > 0 && value < 1
    ? value
    : null;
}

export function displayPrice(market: GammaMarket): number | null {
  const valid = tradablePrice;
  const bid = valid(market.bestBid);
  const ask = valid(market.bestAsk);
  if (bid !== null && ask !== null) return (bid + ask) / 2;
  if (ask !== null) return ask;
  if (bid !== null) return bid;
  return valid(market.lastTradePrice);
}
