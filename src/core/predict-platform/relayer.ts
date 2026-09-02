import { getAddress } from "ethers";
import { z } from "zod";
import type { PredictServiceConfig } from "../config/bootstrap.schema";
import { platformHosts, platformRequest } from "./tenant-client";

/**
 * relayer-service：替用户的 Safe 垫 gas、代为执行。鉴权用 gamma JWT。
 * 接口与 `services/relayer-service/docs/api-reference.md`、user-dapp 的调用一致。
 */

const deployedSchema = z.object({ deployed: z.boolean(), address: z.string() });
const nonceSchema = z.object({ nonce: z.string() });
const submitSchema = z.object({
  transactionID: z.string().min(1),
  transactionHash: z.string(),
  state: z.string(),
});
const transactionSchema = z.object({
  transactionID: z.string(),
  transactionHash: z.string(),
  state: z.string(),
  errorMessage: z.string().optional(),
});
type RelayerTransaction = z.infer<typeof transactionSchema>;

/** 终态（`relayer-service/pkg/types/types.go:39-44`）：mined / confirmed 成功，failed / invalid 失败 */
const FINAL_OK = new Set(["STATE_MINED", "STATE_CONFIRMED"]);
const FINAL_FAILED = new Set(["STATE_FAILED", "STATE_INVALID"]);

export class RelayerTransactionFailedError extends Error {
  constructor(
    readonly transactionID: string,
    readonly state: string,
    detail?: string,
  ) {
    super(detail ?? `relayed transaction ${transactionID} ended in ${state}`);
    this.name = "RelayerTransactionFailedError";
  }
}

export class RelayerTimeoutError extends Error {
  constructor(readonly transactionID: string) {
    super(`relayed transaction ${transactionID} is still pending`);
    this.name = "RelayerTimeoutError";
  }
}

type Auth = { service: PredictServiceConfig; token: string };

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function deployedSafe(
  auth: Auth,
  signer: string,
): Promise<{ deployed: boolean; address: string }> {
  const hosts = platformHosts(auth.service.domain);
  const result = await platformRequest({
    url: `${hosts.relayer}/deployed?signer=${encodeURIComponent(getAddress(signer))}&scopeId=${encodeURIComponent(auth.service.scopeId)}`,
    tenantDomain: auth.service.domain,
    schema: deployedSchema,
    headers: bearer(auth.token),
  });
  return { deployed: result.deployed, address: getAddress(result.address) };
}

export async function safeNonce(auth: Auth, safe: string): Promise<bigint> {
  const hosts = platformHosts(auth.service.domain);
  const result = await platformRequest({
    url: `${hosts.relayer}/nonce?address=${encodeURIComponent(getAddress(safe))}`,
    tenantDomain: auth.service.domain,
    schema: nonceSchema,
    headers: bearer(auth.token),
  });
  return BigInt(result.nonce);
}

/** 与 `relayer-service/pkg/types/types.go` `SubmitRequest` 一致；网页版多发的 `metadata` 服务端不收，不发。 */
type SafeSubmission = {
  from: string;
  to: string;
  proxyWallet: string;
  data: string;
  nonce: bigint;
  signature: string;
  signatureParams: Record<string, string>;
};

export async function submitSafeTx(
  auth: Auth,
  submission: SafeSubmission,
): Promise<string> {
  const hosts = platformHosts(auth.service.domain);
  const result = await platformRequest({
    url: `${hosts.relayer}/submit`,
    tenantDomain: auth.service.domain,
    method: "POST",
    schema: submitSchema,
    headers: bearer(auth.token),
    timeoutMs: 35_000,
    body: {
      from: getAddress(submission.from),
      to: getAddress(submission.to),
      proxyWallet: getAddress(submission.proxyWallet),
      scopeId: auth.service.scopeId,
      data: submission.data,
      nonce: submission.nonce.toString(),
      signature: submission.signature,
      signatureParams: submission.signatureParams,
      type: "SAFE",
    },
  });
  return result.transactionID;
}

export async function submitSafeCreate(
  auth: Auth,
  submission: {
    from: string;
    factory: string;
    proxyWallet: string;
    signature: string;
    signatureParams: Record<string, string>;
  },
): Promise<string> {
  const hosts = platformHosts(auth.service.domain);
  const result = await platformRequest({
    url: `${hosts.relayer}/submit`,
    tenantDomain: auth.service.domain,
    method: "POST",
    schema: submitSchema,
    headers: bearer(auth.token),
    timeoutMs: 35_000,
    body: {
      from: getAddress(submission.from),
      to: getAddress(submission.factory),
      proxyWallet: getAddress(submission.proxyWallet),
      scopeId: auth.service.scopeId,
      signature: submission.signature,
      signatureParams: submission.signatureParams,
      type: "SAFE-CREATE",
    },
  });
  return result.transactionID;
}

async function relayedTransaction(
  auth: Auth,
  id: string,
): Promise<RelayerTransaction> {
  const hosts = platformHosts(auth.service.domain);
  return platformRequest({
    url: `${hosts.relayer}/transaction?id=${encodeURIComponent(id)}`,
    tenantDomain: auth.service.domain,
    schema: transactionSchema,
    headers: bearer(auth.token),
  });
}

/**
 * 轮询到终态。成功返回记录（含 txHash）；失败抛 `RelayerTransactionFailedError`；
 * 超过次数抛 `RelayerTimeoutError`——不静默当成成功。
 */
export async function waitForRelayed(
  auth: Auth,
  id: string,
  options: {
    intervalMs?: number;
    attempts?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<RelayerTransaction> {
  const interval = options.intervalMs ?? 3_000;
  const attempts = options.attempts ?? 40;
  const sleep =
    options.sleep ??
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(interval);
    const record = await relayedTransaction(auth, id);
    if (FINAL_OK.has(record.state)) return record;
    if (FINAL_FAILED.has(record.state))
      throw new RelayerTransactionFailedError(
        id,
        record.state,
        record.errorMessage,
      );
  }
  throw new RelayerTimeoutError(id);
}
