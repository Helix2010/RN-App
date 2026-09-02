import {
  CHAINS,
  NATIVE_TOKEN_ADDRESS,
  type ChainId,
  type TokenRef,
} from "../../gateways/types";

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
  // Monad 上还没有经链上核验的主流合约；预测平台用的 USDC 是否为 Circle 官方部署
  // 未确认，先不背书——租户可以上目录，只是没有估值、转出一律验证
  monad: {},
};

export type AllowlistVerdict =
  /** 地址与元数据都对得上，可以标为已验证 */
  | { status: "verified" }
  /** 不在表里：正常情况（租户上的代币），照常显示；没有参考价，转出一律验证 */
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
  if (token.address === NATIVE_TOKEN_ADDRESS) return { status: "verified" };
  const entry = ALLOWLIST[token.chain]?.[token.address.toLowerCase()];
  if (!entry) return { status: "unlisted" };
  if (entry.symbol !== token.symbol || entry.decimals !== token.decimals)
    return { status: "mismatch", expected: entry };
  return { status: "verified" };
}

/**
 * 某条链上有哪些被客户端背书的合约地址。
 *
 * 目前只有测试在用——它用这份清单反查每条记录都能通过校验，防止表本身写错。
 * 将来管理端做代币目录时，这里也是"这个地址在 App 里会显示成已验证吗"的判据。
 */
export function allowlistedAddresses(chain: ChainId): string[] {
  return Object.keys(ALLOWLIST[chain] ?? {});
}

/**
 * 代币进入界面前的唯一入口。
 *
 * 两件事都必须在这里做，不能留给各个界面自己判断：
 * 1. **重写 `verified`**——下发的这个字段一律不采纳，只有上面那份表能授予；
 * 2. **丢掉 `mismatch` 的代币**。decimals 不符会让显示金额差 10ⁿ 倍，显示一个
 *    错的数字比不显示更危险；这属于配置错误或篡改，同时留一条 warning。
 */
export function trustedTokens<T extends { token: TokenRef }>(items: T[]): T[] {
  const trusted: T[] = [];
  for (const item of items) {
    const verdict = verifyAgainstAllowlist(item.token);
    if (verdict.status === "mismatch") {
      console.warn(
        `[wallet] 丢弃 ${item.token.chain} 上的 ${item.token.address}：` +
          `下发元数据 ${item.token.symbol}/${item.token.decimals} 与已知的 ` +
          `${verdict.expected.symbol}/${verdict.expected.decimals} 不符`,
      );
      continue;
    }
    trusted.push({
      ...item,
      token: { ...item.token, verified: verdict.status === "verified" },
    });
  }
  return trusted;
}

/**
 * 冒名检测：这个代币的符号与同一条链上某个**平台核验**的代币（白名单合约或原生币）相同，
 * 但它不是那个合约。这是白名单在界面上唯一该出声的场景——不在白名单里本身不是问题，
 * 租户上的币和租户一样可信；自称 USDT 却不是主流 USDT 的合约才需要警示。
 * 返回被冒名的那个符号；不是冒名返回 null。
 */
export function impersonatesKnownToken(token: {
  chain: ChainId;
  address: string;
  symbol: string;
}): string | null {
  if (token.address === NATIVE_TOKEN_ADDRESS) return null;
  const symbol = token.symbol.trim().toUpperCase();
  if (symbol === CHAINS[token.chain].nativeSymbol.toUpperCase())
    return CHAINS[token.chain].nativeSymbol;
  for (const [address, entry] of Object.entries(ALLOWLIST[token.chain] ?? {})) {
    if (
      entry.symbol.toUpperCase() === symbol &&
      address !== token.address.toLowerCase()
    )
      return entry.symbol;
  }
  return null;
}
