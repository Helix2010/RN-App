import { getAddress } from "ethers";
import { z } from "zod";
import type { PredictServiceConfig } from "../config/bootstrap.schema";
import { platformHosts, platformRequest } from "./tenant-client";

/**
 * data-service 的公开读接口（无鉴权，只需租户头），按 Safe 地址查。
 * 参数与字段照 user-dapp `lib/api/data.ts` 与 `types/polymarket.ts:268-361`；
 * 数值字段可能是字符串，统一成数字；有的接口包一层 `{data}`，有的直接数组。
 */

const num = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((value) => {
    if (value === null || value === undefined) return 0;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  });

function unwrap<T extends z.ZodTypeAny>(item: T) {
  return z
    .union([z.array(item), z.object({ data: z.array(item) })])
    .transform((value) => (Array.isArray(value) ? value : value.data));
}

function query(params: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== undefined) qs.set(key, String(value));
  return qs.toString();
}

export const positionSchema = z.object({
  proxyWallet: z.string().nullish(),
  asset: z.string(),
  conditionId: z.string(),
  size: num,
  avgPrice: num,
  initialValue: num,
  currentValue: num,
  cashPnl: num,
  percentPnl: num,
  realizedPnl: num,
  curPrice: num,
  redeemable: z.boolean().nullish(),
  mergeable: z.boolean().nullish(),
  marketClosed: z.boolean().nullish(),
  title: z.string().nullish(),
  slug: z.string().nullish(),
  eventSlug: z.string().nullish(),
  endDate: z.string().nullish(),
  outcome: z.string().nullish(),
  outcomeName: z.string().nullish(),
  outcomeIndex: num,
  questionTranslation: z.string().nullish(),
  negRisk: z.boolean().nullish(),
  negativeRisk: z.boolean().nullish(),
});
export type PlatformPosition = z.infer<typeof positionSchema>;

export async function fetchPositions(
  service: PredictServiceConfig,
  safe: string,
  options: { closed?: boolean; limit?: number } = {},
): Promise<PlatformPosition[]> {
  const hosts = platformHosts(service.domain);
  const path = options.closed ? "/closed-positions" : "/positions";
  const params = options.closed
    ? {
        user: getAddress(safe),
        limit: options.limit ?? 50,
        offset: 0,
        sortBy: "REALIZEDPNL",
        sortDirection: "DESC",
      }
    : {
        user: getAddress(safe),
        limit: options.limit ?? 500,
        offset: 0,
        sizeThreshold: 0,
        sortBy: "CURRENT",
        sortDirection: "DESC",
      };
  return platformRequest({
    url: `${hosts.data}${path}?${query(params)}`,
    tenantDomain: service.domain,
    schema: unwrap(positionSchema),
  });
}

export const activitySchema = z.object({
  id: z.string().nullish(),
  type: z.string(),
  conditionId: z.string().nullish(),
  asset: z.string().nullish(),
  side: z.string().nullish(),
  price: num,
  size: num,
  usdcSize: num,
  /** 秒 */
  timestamp: num,
  title: z.string().nullish(),
  questionTranslation: z.string().nullish(),
  slug: z.string().nullish(),
  eventSlug: z.string().nullish(),
  outcome: z.string().nullish(),
  outcomeIndex: num,
});
export type PlatformActivity = z.infer<typeof activitySchema>;

export async function fetchActivity(
  service: PredictServiceConfig,
  safe: string,
  options: { limit?: number } = {},
): Promise<PlatformActivity[]> {
  const hosts = platformHosts(service.domain);
  return platformRequest({
    url: `${hosts.data}/activity?${query({
      user: getAddress(safe),
      limit: options.limit ?? 100,
      offset: 0,
      sortBy: "TIMESTAMP",
      sortDirection: "DESC",
    })}`,
    tenantDomain: service.domain,
    schema: unwrap(activitySchema),
  });
}

export type PnlInterval = "1d" | "1w" | "1m" | "all";
/** 与 user-dapp `data.ts` PNL_PARAMS 一致 */
export const PNL_FIDELITY: Record<PnlInterval, string> = {
  "1d": "1h",
  "1w": "3h",
  "1m": "18h",
  all: "12h",
};

export async function fetchUserPnl(
  service: PredictServiceConfig,
  safe: string,
  interval: PnlInterval,
): Promise<{ t: number; p: number }[]> {
  const hosts = platformHosts(service.domain);
  return platformRequest({
    url: `${hosts.data}/user-pnl?${query({
      user_address: getAddress(safe),
      interval,
      fidelity: PNL_FIDELITY[interval],
    })}`,
    tenantDomain: service.domain,
    schema: unwrap(z.object({ t: num, p: num })),
  });
}

export const leaderboardEntrySchema = z.object({
  rank: num,
  proxyWallet: z.string(),
  userName: z.string().nullish(),
  profileImage: z.string().nullish(),
  pnl: num,
  vol: num,
});
export type PlatformLeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

export async function fetchLeaderboard(
  service: PredictServiceConfig,
  input: {
    orderBy: "PNL" | "VOL";
    timePeriod: "DAY" | "WEEK" | "MONTH" | "ALL";
    limit?: number;
  },
): Promise<PlatformLeaderboardEntry[]> {
  const hosts = platformHosts(service.domain);
  const result = await platformRequest({
    url: `${hosts.data}/v1/leaderboard?${query({
      limit: input.limit ?? 50,
      offset: 0,
      orderBy: input.orderBy,
      timePeriod: input.timePeriod,
    })}`,
    tenantDomain: service.domain,
    schema: z.object({ data: z.array(leaderboardEntrySchema) }),
  });
  return result.data;
}
