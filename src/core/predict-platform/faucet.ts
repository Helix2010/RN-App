import { z } from "zod";
import type { PredictServiceConfig } from "../config/bootstrap.schema";
import { platformHosts, platformRequest } from "./tenant-client";

/** 测试网的 gas 水龙头（JWT 鉴权）；条件由平台判定：Safe 已部署、USDC 余额过线、次数限制。 */
const statusSchema = z.object({
  claimed: z.boolean(),
  safeCreated: z.boolean(),
  dailyRemaining: z.number(),
  amountWei: z.string(),
});
export type FaucetStatus = z.infer<typeof statusSchema>;

export async function faucetStatus(
  service: PredictServiceConfig,
  token: string,
): Promise<FaucetStatus> {
  const hosts = platformHosts(service);
  return platformRequest({
    url: `${hosts.faucet}/api/v1/faucet/status`,
    tenantDomain: service.domain,
    schema: statusSchema,
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function claimFaucet(
  service: PredictServiceConfig,
  token: string,
): Promise<void> {
  const hosts = platformHosts(service);
  await platformRequest({
    url: `${hosts.faucet}/api/v1/faucet/claim`,
    tenantDomain: service.domain,
    method: "POST",
    schema: z.unknown(),
    headers: { Authorization: `Bearer ${token}` },
    body: {},
  });
}
