import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { getAddress, type TypedDataDomain, type TypedDataField } from "ethers";
import { z } from "zod";
import type { PredictServiceConfig } from "../config/bootstrap.schema";
import type { SignRequestContext, WalletSigner } from "../wallet/signer/types";
import { evmChainIdOf } from "../wallet/config/wallet-runtime-config";
import {
  PlatformHttpError,
  platformHosts,
  platformRequest,
} from "./tenant-client";

/**
 * clob-service 的两层鉴权，与 user-dapp `lib/hmac.ts`、`useSetupSteps.ts:469-521` 一致：
 * - L1：签 `ClobAuth`（EIP-712）换 API key；头 `PRED_ADDRESS / PRED_SIGNATURE / PRED_TIMESTAMP /
 *   PRED_NONCE` + `PRED_SCOPE_ID`。clob 没有租户中间件，租户身份只在这一步绑进密钥，
 *   所以 `PRED_SCOPE_ID` 对我们必填；
 * - L2：`base64(HMAC-SHA256(base64url解码(secret), ts + METHOD + path + body))`，头
 *   `PRED_API_KEY / PRED_PASSPHRASE / PRED_SIGNATURE / PRED_TIMESTAMP / PRED_ADDRESS`，
 *   时间戳取平台服务器时间（容差 ±30 秒）。
 */

export type ClobCredentials = {
  apiKey: string;
  secret: string;
  passphrase: string;
};

const credentialsSchema = z
  .object({
    apiKey: z.string().min(1),
    secret: z.string().min(1),
    passphrase: z.string().min(1),
  })
  .transform((value) => value as ClobCredentials);

/** clob `GET /time`：平台自己的秒级时间。接受纯数字、数字字符串或 `{ time }`。 */
const timeSchema = z
  .union([
    z.number(),
    z.string(),
    z.object({ time: z.union([z.number(), z.string()]) }),
  ])
  .transform((value, ctx) => {
    const raw = typeof value === "object" ? value.time : value;
    const seconds = Math.floor(Number(raw));
    if (!Number.isFinite(seconds) || seconds <= 0) {
      ctx.addIssue({
        code: "custom",
        message: `not a timestamp: ${String(raw)}`,
      });
      return z.NEVER;
    }
    return seconds;
  });

export async function clobServerTime(
  service: PredictServiceConfig,
): Promise<number> {
  const hosts = platformHosts(service.domain);
  return platformRequest({
    url: `${hosts.clob}/time`,
    tenantDomain: service.domain,
    schema: timeSchema,
  });
}

const CLOB_AUTH_TYPES: Record<string, TypedDataField[]> = {
  ClobAuth: [
    { name: "address", type: "address" },
    { name: "timestamp", type: "string" },
    { name: "nonce", type: "uint256" },
    { name: "scopeId", type: "bytes32" },
    { name: "message", type: "string" },
  ],
};

const CLOB_AUTH_MESSAGE =
  "This message attests that I control the given wallet";

export function clobAuthTypedData(
  chainId: number,
  address: string,
  timestamp: string,
  scopeId: string,
): {
  domain: TypedDataDomain;
  types: Record<string, TypedDataField[]>;
  value: Record<string, unknown>;
} {
  return {
    domain: { name: "ClobAuthDomain", version: "1", chainId },
    types: CLOB_AUTH_TYPES,
    value: {
      address: getAddress(address),
      timestamp,
      nonce: 0n,
      scopeId,
      message: CLOB_AUTH_MESSAGE,
    },
  };
}

/** 先 derive（已有密钥就还回来），没有再 create。两者都返回同一形状。 */
export async function obtainClobCredentials(
  service: PredictServiceConfig,
  signer: WalletSigner,
  context: SignRequestContext,
): Promise<ClobCredentials> {
  const hosts = platformHosts(service.domain);
  const timestamp = String(await clobServerTime(service));
  const typed = clobAuthTypedData(
    evmChainIdOf(service.chain),
    signer.address,
    timestamp,
    service.scopeId,
  );
  const signature = await signer.signTypedData(
    typed.domain,
    typed.types,
    typed.value,
    context,
  );
  const headers = {
    PRED_ADDRESS: getAddress(signer.address),
    PRED_SIGNATURE: signature,
    PRED_TIMESTAMP: timestamp,
    PRED_NONCE: "0",
    PRED_SCOPE_ID: service.scopeId,
  };
  try {
    return await platformRequest({
      url: `${hosts.clob}/auth/derive-api-key`,
      tenantDomain: service.domain,
      schema: credentialsSchema,
      headers,
    });
  } catch (error) {
    // derive 只对已有密钥的地址成功，第一次是 404（`clob-service/.../auth.go:213-242`）
    // → 走 create。其它错误（410 已吊销、429、网络）原样抛出，不再多签一次
    if (!(error instanceof PlatformHttpError) || error.status !== 404)
      throw error;
  }
  return platformRequest({
    url: `${hosts.clob}/auth/api-key`,
    tenantDomain: service.domain,
    method: "POST",
    schema: credentialsSchema,
    headers,
    body: {},
  });
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = globalThis.atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

/** L2 签名头。`path` 不含查询串（与 user-dapp 一致），GET 的 body 为空串。 */
export function l2Headers(
  credentials: ClobCredentials,
  address: string,
  method: string,
  path: string,
  timestampSeconds: number,
  body = "",
): Record<string, string> {
  const message = `${timestampSeconds}${method.toUpperCase()}${path}${body}`;
  const signature = base64Encode(
    hmac(
      sha256,
      base64UrlDecode(credentials.secret),
      new TextEncoder().encode(message),
    ),
  );
  return {
    PRED_ADDRESS: getAddress(address),
    PRED_API_KEY: credentials.apiKey,
    PRED_PASSPHRASE: credentials.passphrase,
    PRED_SIGNATURE: signature,
    PRED_TIMESTAMP: String(timestampSeconds),
  };
}

const balanceAllowanceSchema = z.object({
  balance: z.string(),
  virtual_available: z.string().optional(),
  locked: z.string().optional(),
});
type BalanceAllowance = {
  balance: bigint;
  /**
   * 扣掉挂单冻结后的可用额度。平台把 `virtual_available` / `locked` 标成 omitempty，
   * 恰好在余额管理器没有这个钱包的条目（没有挂单）时省略（`clob-service/.../handlers.go:2087-2124`），
   * 所以缺省等于 balance、locked 为 0 是平台语义，不是兜底。
   */
  available: bigint;
  locked: bigint;
};

/**
 * 让 clob 立刻重读该地址（服务端按 scopeId 推导 Safe）的子图余额：`GET /balance-allowance/update`
 * （`handlers.go` UpdateBalanceAllowance）。clob 平时按周期同步，转入 / 领取后不调这一下，
 * "可用余额"要等下一轮才变。只返回 200，无正文。
 */
export async function refreshBalanceAllowance(
  service: PredictServiceConfig,
  credentials: ClobCredentials,
  address: string,
): Promise<void> {
  const hosts = platformHosts(service.domain);
  const timestamp = await clobServerTime(service);
  const path = "/balance-allowance/update";
  await platformRequest({
    url: `${hosts.clob}${path}`,
    tenantDomain: service.domain,
    headers: l2Headers(credentials, address, "GET", path, timestamp),
    schema: z.unknown(),
  });
}

export async function balanceAllowance(
  service: PredictServiceConfig,
  credentials: ClobCredentials,
  address: string,
): Promise<BalanceAllowance> {
  const hosts = platformHosts(service.domain);
  const timestamp = await clobServerTime(service);
  const path = "/balance-allowance";
  const result = await platformRequest({
    url: `${hosts.clob}${path}?asset_type=COLLATERAL`,
    tenantDomain: service.domain,
    schema: balanceAllowanceSchema,
    headers: l2Headers(credentials, address, "GET", path, timestamp),
  });
  const balance = BigInt(result.balance);
  return {
    balance,
    available:
      result.virtual_available === undefined
        ? balance
        : BigInt(result.virtual_available),
    locked: result.locked === undefined ? 0n : BigInt(result.locked),
  };
}
