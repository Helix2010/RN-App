import type { ChainId } from "../../gateways/types";

/**
 * 客户端认可的主流代币合约地址。
 *
 * 为什么必须在客户端：代币目录由服务端下发，其中的 `verified` 标记也来自服务端——
 * 服务端被攻破时它可以把攻击者的合约标成"已验证"。所以 `verified` 只能由这份
 * 表授予，**下发的 verified 值一律不采纳**。
 *
 * 表里同时存 symbol 与 decimals，是为了拦住更严重的一类问题：decimals 错会让
 * 金额差 10ⁿ 倍。下面这组值全部经链上 `symbol()` / `decimals()` 核验过，其中
 * 有一条值得记住——**同一个 USDT，BSC 上是 18 位，以太坊上是 6 位**。凭直觉填
 * 必然出错，所以既要从链上读，也要在客户端留一份对照。
 */

type AllowlistEntry = { symbol: string; decimals: number };

const ALLOWLIST: Record<ChainId, Record<string, AllowlistEntry>> = {
  bsc: {
    "0x55d398326f99059ff775485246999027b3197955": {
      symbol: "USDT",
      decimals: 18,
    },
    "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": {
      symbol: "USDC",
      decimals: 18,
    },
  },
  eth: {
    "0xdac17f958d2ee523a2206206994597c13d831ec7": {
      symbol: "USDT",
      decimals: 6,
    },
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
      symbol: "USDC",
      decimals: 6,
    },
  },
  base: {
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": {
      symbol: "USDC",
      decimals: 6,
    },
  },
  // 测试链上的代币没有价值，不给任何"已验证"背书
  "op-sepolia": {},
};

export type AllowlistVerdict =
  /** 地址与元数据都对得上，可以标为已验证 */
  | { status: "verified" }
  /** 不在表里：正常情况（租户自定义代币），按未验证展示 */
  | { status: "unlisted" }
  /**
   * 在表里但元数据不符——这是配置错误或篡改，**应当拒绝这个代币**而不是
   * 降级展示：decimals 错会让金额差 10ⁿ 倍。
   */
  | { status: "mismatch"; expected: AllowlistEntry };

export function verifyAgainstAllowlist(token: {
  chain: ChainId;
  address: string;
  symbol: string;
  decimals: number;
}): AllowlistVerdict {
  // 原生币不来自合约，由链目录描述，不需要地址背书
  if (token.address === "native") return { status: "verified" };
  const entry = ALLOWLIST[token.chain]?.[token.address.toLowerCase()];
  if (!entry) return { status: "unlisted" };
  if (entry.symbol !== token.symbol || entry.decimals !== token.decimals)
    return { status: "mismatch", expected: entry };
  return { status: "verified" };
}

/** 供测试与管理端提示：某条链上有哪些被客户端背书的合约地址。 */
export function allowlistedAddresses(chain: ChainId): string[] {
  return Object.keys(ALLOWLIST[chain] ?? {});
}
