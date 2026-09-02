import { z } from "zod";
import type { PredictServiceConfig } from "../config/bootstrap.schema";
import { clobServerTime, l2Headers, type ClobCredentials } from "./clob-auth";
import { platformHosts, platformRequest } from "./tenant-client";

/**
 * clob-service 的订单接口（L2 HMAC）。响应照 `apidoc/types.go:100-111`，
 * 状态与"未完成"判据照 user-dapp `hooks/useOpenOrders.ts:70-79`。
 */

const numeric = z.union([z.number(), z.string()]).transform((value) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
});

export const openOrderSchema = z.object({
  id: z.string(),
  status: z.string(),
  owner: z.string().nullish(),
  maker_address: z.string().nullish(),
  /** conditionId */
  market: z.string(),
  asset_id: z.string(),
  side: z.string(),
  outcome: z.string().nullish(),
  original_size: numeric,
  size_matched: numeric,
  price: numeric,
  order_type: z.string().nullish(),
  created_at: z.union([z.string(), z.number()]).nullish(),
  expiration: z.union([z.string(), z.number()]).nullish(),
});
export type ClobOpenOrder = z.infer<typeof openOrderSchema>;

export type ClobAuth = { credentials: ClobCredentials; address: string };

/** 未完成 = LIVE，或原量减成交量还有余（`useOpenOrders.ts:70-79`） */
export function isOpenOrder(order: ClobOpenOrder): boolean {
  const status = order.status
    .replace(/^ORDER_STATUS_/, "")
    .replace(/^CANCELED$/, "CANCELLED");
  if (status === "CANCELLED" || status === "MATCHED") return false;
  if (status === "LIVE") return true;
  return order.original_size - order.size_matched > 1e-6;
}

export async function fetchOpenOrders(
  service: PredictServiceConfig,
  auth: ClobAuth,
  marketConditionId?: string,
): Promise<ClobOpenOrder[]> {
  const hosts = platformHosts(service.domain);
  const timestamp = await clobServerTime(service);
  const path = "/orders";
  const qs = marketConditionId
    ? `?market=${encodeURIComponent(marketConditionId)}`
    : "";
  const result = await platformRequest({
    url: `${hosts.clob}${path}${qs}`,
    tenantDomain: service.domain,
    schema: z
      .union([
        z.array(openOrderSchema),
        z.object({ data: z.array(openOrderSchema) }),
      ])
      .transform((value) => (Array.isArray(value) ? value : value.data)),
    headers: l2Headers(auth.credentials, auth.address, "GET", path, timestamp),
  });
  return result.filter(isOpenOrder);
}

export async function cancelOpenOrder(
  service: PredictServiceConfig,
  auth: ClobAuth,
  orderId: string,
): Promise<void> {
  const hosts = platformHosts(service.domain);
  const timestamp = await clobServerTime(service);
  const path = "/order";
  const body = { orderID: orderId };
  await platformRequest({
    url: `${hosts.clob}${path}`,
    tenantDomain: service.domain,
    method: "DELETE",
    body,
    schema: z.unknown(),
    headers: l2Headers(
      auth.credentials,
      auth.address,
      "DELETE",
      path,
      timestamp,
      JSON.stringify(body),
    ),
  });
}
