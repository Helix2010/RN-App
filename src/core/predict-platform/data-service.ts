import { getAddress } from "ethers";
import { z } from "zod";
import type { PredictServiceConfig } from "../config/bootstrap.schema";
import { platformHosts, platformRequest } from "./tenant-client";

/** data-service `GET /unwrap-requests?safe=&claimed=false`（子图索引，有延迟）。 */
const unwrapRequestSchema = z.object({
  requestId: z.string().min(1),
  recipient: z.string(),
  asset: z.string(),
  usdwAmount: z.string(),
  assetAmount: z.string(),
  claimableAt: z.string(),
  claimed: z.boolean(),
  initTxHash: z.string(),
  initTimestamp: z.string(),
  claimTxHash: z.string().optional(),
});
type UnwrapRequestRecord = z.infer<typeof unwrapRequestSchema>;

export async function listUnwrapRequests(
  service: PredictServiceConfig,
  safe: string,
  options: { claimed?: boolean } = {},
): Promise<UnwrapRequestRecord[]> {
  const hosts = platformHosts(service.domain);
  const claimed =
    options.claimed === undefined ? "" : `&claimed=${options.claimed}`;
  const result = await platformRequest({
    url: `${hosts.data}/unwrap-requests?safe=${encodeURIComponent(getAddress(safe))}${claimed}`,
    tenantDomain: service.domain,
    schema: z.object({ data: z.array(unwrapRequestSchema) }),
  });
  return result.data;
}
