import { z } from "zod";
import type { PredictServiceConfig } from "../config/bootstrap.schema";
import { platformHosts, platformRequest } from "./tenant-client";

/**
 * 地区限制检查（user-dapp `app/api/geoblock/route.ts` 代理的 `GET {GEO_CHECK_URL}/geoblock`）。
 * 与网页版的两点差异（设计 `predict-geoblock-2026-09-08.md` §4）：
 * - App 直接请求，地理服务看到的是手机的真实出口 IP；
 * - 请求失败 / 响应不合契约照常抛错，调用方按失败处理，不当作"不受限"。
 * 管理端没配地址就是不做地区限制（声明式默认，管理端可见），此时不发请求。
 */
const regionSchema = z.object({ restricted: z.boolean() });

export type RegionAccess = {
  restricted: boolean;
  /** false = 租户没配地理检查，没有问过任何服务 */
  checked: boolean;
};

export async function fetchRegionAccess(
  service: PredictServiceConfig,
): Promise<RegionAccess> {
  const base = platformHosts(service).geo;
  if (base === null) return { restricted: false, checked: false };
  const result = await platformRequest({
    url: `${base}/geoblock`,
    tenantDomain: service.domain,
    schema: regionSchema,
  });
  return { restricted: result.restricted, checked: true };
}
