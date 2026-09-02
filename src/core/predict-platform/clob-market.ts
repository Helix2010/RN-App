import { z } from "zod";
import type { PredictServiceConfig } from "../config/bootstrap.schema";
import { platformHosts, platformRequest } from "./tenant-client";

/**
 * clob-service 的公开行情接口（无鉴权，只需租户头）。参数与响应照 user-dapp `lib/api/clob.ts`。
 * 价格是 0–1 的小数字符串，份数是小数字符串；这里原样保留字符串，换算由调用方做。
 */

const numeric = z.union([z.number(), z.string()]).transform((value) => {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`not a number: ${value}`);
  return parsed;
});

export const bookLevelSchema = z.object({ price: numeric, size: numeric });

export const orderBookSchema = z.object({
  market: z.string(),
  asset_id: z.string(),
  bids: z.array(bookLevelSchema),
  asks: z.array(bookLevelSchema),
  tick_size: numeric.nullish(),
  min_order_size: numeric.nullish(),
  last_trade_price: numeric.nullish(),
  /** 毫秒或秒的时间戳字符串 */
  timestamp: z.union([z.string(), z.number()]).nullish(),
});
export type ClobOrderBook = z.infer<typeof orderBookSchema>;

export async function fetchOrderBook(
  service: PredictServiceConfig,
  tokenId: string,
): Promise<ClobOrderBook> {
  const hosts = platformHosts(service.domain);
  return platformRequest({
    url: `${hosts.clob}/book?token_id=${encodeURIComponent(tokenId)}`,
    tenantDomain: service.domain,
    schema: orderBookSchema,
  });
}

export async function fetchTickSize(
  service: PredictServiceConfig,
  tokenId: string,
): Promise<number> {
  const hosts = platformHosts(service.domain);
  const result = await platformRequest({
    url: `${hosts.clob}/tick-size?token_id=${encodeURIComponent(tokenId)}`,
    tenantDomain: service.domain,
    schema: z.object({ minimum_tick_size: numeric }),
  });
  return result.minimum_tick_size;
}

/** 费率，bps（`handlers/marketdata.go:123-157`：`max(taker_total, maker_total)`） */
export async function fetchFeeRateBps(
  service: PredictServiceConfig,
  tokenId: string,
): Promise<number> {
  const hosts = platformHosts(service.domain);
  const result = await platformRequest({
    url: `${hosts.clob}/fee-rate/${encodeURIComponent(tokenId)}?scope_id=${encodeURIComponent(service.scopeId)}`,
    tenantDomain: service.domain,
    schema: z.object({ base_fee: numeric }),
  });
  return result.base_fee;
}

export type PriceHistoryInterval = "1d" | "1w" | "1m" | "max";

export const priceHistorySchema = z.object({
  history: z.array(z.object({ t: numeric, p: numeric })),
});

export async function fetchPriceHistory(
  service: PredictServiceConfig,
  input: {
    tokenId: string;
    interval: PriceHistoryInterval;
    fidelity?: number;
    startTs?: number;
    endTs?: number;
  },
): Promise<{ t: number; p: number }[]> {
  const hosts = platformHosts(service.domain);
  const qs = new URLSearchParams({
    token_id: input.tokenId,
    interval: input.interval,
  });
  if (input.fidelity !== undefined) qs.set("fidelity", String(input.fidelity));
  if (input.startTs !== undefined) qs.set("startTs", String(input.startTs));
  if (input.endTs !== undefined) qs.set("endTs", String(input.endTs));
  const result = await platformRequest({
    url: `${hosts.clob}/price-history?${qs.toString()}`,
    tenantDomain: service.domain,
    schema: priceHistorySchema,
  });
  return result.history;
}
