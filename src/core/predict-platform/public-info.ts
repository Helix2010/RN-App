import { getAddress } from "ethers";
import { z } from "zod";
import type { PredictServiceConfig } from "../config/bootstrap.schema";
import { evmChainIdOf } from "../wallet/config/wallet-runtime-config";
import { platformHosts, platformRequest } from "./tenant-client";

/**
 * `GET {gamma}/public-info`：平台侧这个租户的配置——scopeId、链、合约地址、代币。
 *
 * 只取用我们需要的字段，其余原样忽略。取回后必须与下发的关联断言：scopeId 与 chainId
 * 任一不符就是配错了平台（凭证会发往别的租户），拒绝启用。
 */

const addressSchema = z.string().transform((value, ctx) => {
  try {
    return getAddress(value);
  } catch {
    ctx.addIssue({ code: "custom", message: `not an EVM address: ${value}` });
    return z.NEVER;
  }
});

export const publicInfoSchema = z.object({
  scopeId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  chain: z.object({
    chainId: z.number().int().positive(),
    name: z.string(),
    tokens: z.array(
      z.object({
        address: addressSchema,
        symbol: z.string(),
        decimals: z.number().int().nonnegative(),
      }),
    ),
    contracts: z.array(z.object({ name: z.string(), address: addressSchema })),
  }),
  contracts: z.object({
    exchangeAddress: addressSchema,
    negRiskExchangeAddress: addressSchema,
    ctfAddress: addressSchema,
    collateralToken: addressSchema,
  }),
  loginStatement: z.string(),
  agreements: z
    .array(
      z.object({
        type: z.string(),
        version: z.string(),
        titleTranslation: z.string(),
        contentTranslation: z.string(),
      }),
    )
    .optional(),
});
export type PublicInfo = z.infer<typeof publicInfoSchema>;

export class PredictPlatformMismatchError extends Error {
  constructor(
    readonly reason: "scopeId" | "chainId",
    detail: string,
  ) {
    super(detail);
    this.name = "PredictPlatformMismatchError";
  }
}

class PredictPlatformContractMissingError extends Error {
  constructor(readonly contract: string) {
    super(`public-info does not list the ${contract} contract`);
    this.name = "PredictPlatformContractMissingError";
  }
}

export async function fetchPublicInfo(
  service: PredictServiceConfig,
): Promise<PublicInfo> {
  const hosts = platformHosts(service.domain);
  const info = await platformRequest({
    url: `${hosts.gamma}/public-info`,
    tenantDomain: service.domain,
    schema: publicInfoSchema,
  });
  assertPublicInfoMatches(info, service);
  return info;
}

/** 平台说的租户与链必须和下发的关联一致，否则这不是我们的租户。 */
export function assertPublicInfoMatches(
  info: PublicInfo,
  service: PredictServiceConfig,
): void {
  if (info.scopeId.toLowerCase() !== service.scopeId)
    throw new PredictPlatformMismatchError(
      "scopeId",
      `platform scopeId ${info.scopeId} does not match the configured ${service.scopeId}`,
    );
  const expected = evmChainIdOf(service.chain);
  if (info.chain.chainId !== expected)
    throw new PredictPlatformMismatchError(
      "chainId",
      `platform chainId ${info.chain.chainId} does not match ${service.chain} (${expected})`,
    );
}

/** 需要的平台合约；缺一个就不能工作，如实抛错。 */
export type PlatformContracts = {
  usdw: string;
  usdcUnderlying: string;
  usdwWrapper: string;
  multiSend: string;
  safeFactory: string;
  ctf: string;
  ctfExchange: string;
  negRiskAdapter: string;
  negRiskExchange: string;
  /** USDW 与底层 USDC 的精度（平台 tokens 列表） */
  usdwDecimals: number;
  usdcDecimals: number;
};

export function platformContracts(info: PublicInfo): PlatformContracts {
  const byName = new Map(
    info.chain.contracts.map((item) => [item.name, item.address]),
  );
  const need = (name: string): string => {
    const address = byName.get(name);
    if (!address) throw new PredictPlatformContractMissingError(name);
    return address;
  };
  const usdw = info.contracts.collateralToken;
  const usdcUnderlying = need("USDC_UNDERLYING");
  const decimalsOf = (address: string): number => {
    const token = info.chain.tokens.find(
      (item) => item.address.toLowerCase() === address.toLowerCase(),
    );
    if (!token)
      throw new PredictPlatformContractMissingError(`token ${address}`);
    return token.decimals;
  };
  return {
    usdw,
    usdcUnderlying,
    usdwWrapper: need("USDW_WRAPPER"),
    multiSend: need("MULTI_SEND_ADDRESS"),
    safeFactory: need("SAFE_FACTORY_ADDRESS"),
    ctf: info.contracts.ctfAddress,
    ctfExchange: info.contracts.exchangeAddress,
    negRiskAdapter: need("NEG_RISK_ADAPTER"),
    negRiskExchange: info.contracts.negRiskExchangeAddress,
    usdwDecimals: decimalsOf(usdw),
    usdcDecimals: decimalsOf(usdcUnderlying),
  };
}
