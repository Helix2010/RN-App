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
 * 平台登录：EIP-712 `LoginMessage` 换 gamma JWT（不是 SIWE）。
 *
 * 字段与 gamma-service `internal/auth/eip712.go` 一致：domain 只有 name / version /
 * chainId（无 verifyingContract）；`scopeId` 按 uint256 签、按 0x-hex 传；`domain` 字段
 * 必须是平台登记的域名，我们签下发的接口域名；nonce 验签之前就核销，失败要重取。
 */

const LOGIN_TYPES: Record<string, TypedDataField[]> = {
  LoginMessage: [
    { name: "wallet", type: "address" },
    { name: "nonce", type: "string" },
    { name: "scopeId", type: "uint256" },
    { name: "issuedAt", type: "string" },
    { name: "domain", type: "string" },
    { name: "uri", type: "string" },
    { name: "chainId", type: "uint256" },
  ],
};

const nonceSchema = z.object({
  nonce: z.string().min(1),
  scopeId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  issuedAt: z.string().min(1),
  chainId: z.number().int().positive(),
  statement: z.string(),
});
type LoginNonce = z.infer<typeof nonceSchema>;

const tokenSchema = z.object({ token: z.string().min(1) });

type LoginMessageParams = {
  address: string;
  nonce: string;
  scopeId: string;
  issuedAt: string;
  domain: string;
  uri: string;
  chainId: number;
};

export function loginTypedData(params: LoginMessageParams): {
  domain: TypedDataDomain;
  types: Record<string, TypedDataField[]>;
  value: Record<string, unknown>;
} {
  return {
    domain: { name: "PredictMarket", version: "1", chainId: params.chainId },
    types: LOGIN_TYPES,
    value: {
      wallet: getAddress(params.address),
      nonce: params.nonce,
      scopeId: BigInt(params.scopeId),
      issuedAt: params.issuedAt,
      domain: params.domain,
      uri: params.uri,
      chainId: BigInt(params.chainId),
    },
  };
}

async function fetchLoginNonce(
  service: PredictServiceConfig,
  address: string,
): Promise<LoginNonce> {
  const hosts = platformHosts(service);
  return platformRequest({
    url: `${hosts.gamma}/auth/nonce?address=${encodeURIComponent(getAddress(address))}`,
    tenantDomain: service.domain,
    schema: nonceSchema,
  });
}

/** gamma 的 nonce 已核销 / 过期 / 不符（`types.go` ErrNonceInvalid） */
const ERR_NONCE_INVALID = "40101";

/**
 * 整个登录：取 nonce → 签 → 换 JWT。
 * nonce 在验签前就被核销（§2.2），登录返回 40101 时重取一次 nonce 再签，只重试一次。
 */
export async function loginWithSigner(
  service: PredictServiceConfig,
  signer: WalletSigner,
  context: SignRequestContext,
): Promise<string> {
  try {
    return await loginOnce(service, signer, context);
  } catch (error) {
    if (
      error instanceof PlatformHttpError &&
      error.status === 401 &&
      error.code === ERR_NONCE_INVALID
    )
      return loginOnce(service, signer, context);
    throw error;
  }
}

async function loginOnce(
  service: PredictServiceConfig,
  signer: WalletSigner,
  context: SignRequestContext,
): Promise<string> {
  const nonce = await fetchLoginNonce(service, signer.address);
  const expectedChain = evmChainIdOf(service.chain);
  if (nonce.chainId !== expectedChain)
    throw new Error(
      `platform login nonce is for chainId ${nonce.chainId}, expected ${expectedChain}`,
    );
  if (nonce.scopeId.toLowerCase() !== service.scopeId)
    throw new Error(
      `platform login nonce is for scope ${nonce.scopeId}, expected ${service.scopeId}`,
    );
  const params: LoginMessageParams = {
    address: signer.address,
    nonce: nonce.nonce,
    scopeId: nonce.scopeId,
    issuedAt: nonce.issuedAt,
    domain: service.domain,
    uri: `https://${service.domain}`,
    chainId: nonce.chainId,
  };
  const typed = loginTypedData(params);
  const signature = await signer.signTypedData(
    typed.domain,
    typed.types,
    typed.value,
    context,
  );
  const hosts = platformHosts(service);
  const result = await platformRequest({
    url: `${hosts.gamma}/auth/login`,
    tenantDomain: service.domain,
    method: "POST",
    schema: tokenSchema,
    body: {
      signature,
      messageParams: {
        address: getAddress(params.address),
        nonce: params.nonce,
        scopeId: params.scopeId,
        issuedAt: params.issuedAt,
        domain: params.domain,
        uri: params.uri,
        chainId: params.chainId,
      },
    },
  });
  return result.token;
}

export async function refreshToken(
  service: PredictServiceConfig,
  token: string,
): Promise<string> {
  const hosts = platformHosts(service);
  const result = await platformRequest({
    url: `${hosts.gamma}/auth/refresh`,
    tenantDomain: service.domain,
    method: "POST",
    schema: tokenSchema,
    headers: { Authorization: `Bearer ${token}` },
    body: {},
  });
  return result.token;
}

type JwtClaims = {
  sub: string;
  exp: number;
  iat: number;
  scope_id: string;
};

function base64UrlDecode(value: string): string {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  return globalThis.atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
}

/** 只解码不验签：验签是平台的事，我们只用它判断"还能不能用、是不是这个地址的"。 */
export function decodeJwt(token: string): JwtClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as Record<
      string,
      unknown
    >;
    if (
      typeof payload.sub !== "string" ||
      typeof payload.exp !== "number" ||
      typeof payload.iat !== "number" ||
      typeof payload.scope_id !== "string"
    )
      return null;
    return {
      sub: payload.sub,
      exp: payload.exp,
      iat: payload.iat,
      scope_id: payload.scope_id,
    };
  } catch {
    return null;
  }
}

/** JWT 是否属于这个地址、这个租户，且还有至少 `marginSeconds` 的余量。 */
export function jwtUsable(
  token: string,
  address: string,
  scopeId: string,
  nowSeconds: number,
  marginSeconds = 300,
): boolean {
  const claims = decodeJwt(token);
  if (!claims) return false;
  return (
    claims.sub.toLowerCase() === address.toLowerCase() &&
    claims.scope_id.toLowerCase() === scopeId.toLowerCase() &&
    claims.exp - nowSeconds > marginSeconds
  );
}
