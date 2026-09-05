import { z } from "zod";
import type { PredictServiceConfig } from "../config/bootstrap.schema";
import { platformHosts, platformRequest } from "./tenant-client";

/**
 * data-service `GET /trades?market=<conditionId>&limit=`：公开成交流水
 * （网页版经 BFF `/api/predict/trades` 转发，字段归一化见 `lib/api.ts` fetchTrades）。
 * 响应可能是数组，也可能包在 `data` / `trades` 里；时间戳可能是秒、毫秒或 ISO 串。
 */
const num = z.union([z.number(), z.string()]).transform((value) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
});

const tradeSchema = z.object({
  id: z.union([z.string(), z.number()]).nullish(),
  conditionId: z.string().nullish(),
  outcome: z.string().nullish(),
  outcomeIndex: z.union([z.number(), z.string()]).nullish(),
  side: z.string().nullish(),
  price: num,
  size: num,
  timestamp: z.union([z.number(), z.string()]).nullish(),
  transactionHash: z.string().nullish(),
});
export type PlatformTrade = z.infer<typeof tradeSchema>;

const responseSchema = z.union([
  z.array(tradeSchema),
  z.object({ data: z.array(tradeSchema) }),
  z.object({ trades: z.array(tradeSchema) }),
]);

export async function fetchTrades(
  service: PredictServiceConfig,
  conditionId: string,
  limit = 50,
): Promise<PlatformTrade[]> {
  const hosts = platformHosts(service);
  const result = await platformRequest({
    url: `${hosts.data}/trades?market=${encodeURIComponent(conditionId)}&limit=${limit}`,
    tenantDomain: service.domain,
    schema: responseSchema,
  });
  if (Array.isArray(result)) return result;
  return "data" in result ? result.data : result.trades;
}

/** 成交时间戳 → 毫秒；秒 / 毫秒 / ISO 串都认，认不出来返回 null */
export function tradeTimestampMs(
  raw: PlatformTrade["timestamp"],
): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const numeric = typeof raw === "number" ? raw : Number(raw);
  if (Number.isFinite(numeric))
    return numeric > 1e10 ? numeric : numeric * 1000;
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : null;
}
