import { z } from "zod";
import type { PredictServiceConfig } from "../config/bootstrap.schema";
import { platformHosts, platformRequest } from "./tenant-client";

/**
 * data-service `GET /holders?market=<conditionId>&limit=`（user-dapp `lib/api/data.ts getHolders`）：
 * 按结果代币分组的持有人榜。outcomeIndex 0 = YES、1 = NO。
 */
const holderSchema = z.object({
  proxyWallet: z.string(),
  asset: z.string().nullish(),
  name: z.string().nullish(),
  pseudonym: z.string().nullish(),
  amount: z.union([z.number(), z.string()]).transform(Number),
  outcomeIndex: z.number(),
  displayUsernamePublic: z.boolean().nullish(),
});
const holderGroupSchema = z.object({
  token: z.string().nullish(),
  holders: z.array(holderSchema),
});
export type PlatformHolderGroup = z.infer<typeof holderGroupSchema>;

export async function fetchHolders(
  service: PredictServiceConfig,
  conditionId: string,
  limit = 10,
): Promise<PlatformHolderGroup[]> {
  const hosts = platformHosts(service);
  return platformRequest({
    url: `${hosts.data}/holders?market=${encodeURIComponent(conditionId)}&limit=${limit}`,
    tenantDomain: service.domain,
    schema: z.array(holderGroupSchema),
  });
}
