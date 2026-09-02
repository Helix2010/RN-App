import {
  NATIVE_TOKEN_ADDRESS,
  type ChainId,
  type TokenRef,
} from "../../gateways/types";
import { classifyEvmAddress, normalizeEvmAddress } from "../address";

/**
 * 服务端在 bootstrap 里下发的钱包运行时参数。
 *
 * 这里**只有服务端这一条来源**：没有构建期兜底，也没有"未下发时的默认值"。
 * projectId、链集合、端点、代币目录都是租户配置。还没收到下发时这里就是"没有链"
 * （`enabledChains()` 为空），依赖它的界面如实呈现空态；问一条没启用的链直接抛错——
 * 那是调用方的 bug，不是需要兜住的状态。
 */

export type WalletNetwork = {
  id: ChainId;
  /** EIP-155 chain id，签名与 WalletConnect namespace 都用它 */
  chainId: number;
  rpcUrls: string[];
  explorerUrl: string;
  /** 测试链。App 里要显式提示，别让用户当成主网用 */
  testnet: boolean;
};

/**
 * 服务端下发的代币目录条目：就是 `TokenRef` 去掉 `verified`。
 *
 * verified 不在下发里、下发了也不采纳——它只能由客户端白名单授予
 * （token-allowlist.ts），否则一个被攻破的服务端能把攻击者的合约标成"已验证"。
 */
export type DeliveredToken = Omit<TokenRef, "verified">;

type DeliveredWalletConfig = {
  walletConnectProjectId: string;
  networks: WalletNetwork[];
  /** 转出是否真的上链。false 是显式的"演示账本"状态，不是回退 */
  onchainSends: boolean;
  /** 代币目录（含原生币条目） */
  tokens: DeliveredToken[];
};

/**
 * 协议事实：每条链的 EIP-155 chain id 与是否测试链。
 *
 * 这不是配置，也不是兜底——它是**安全断言**：下发值必须与它一致，否则拒绝该条链。
 * chainId 是 EIP-155 重放保护的输入：如果服务端（或到服务端的链路）被篡改成另一条链
 * 的 id，用户签出的交易可以在那条链上重放。端点和 projectId 可以由租户随意配置，
 * chainId 与"是不是测试链"不行——它们属于协议，不属于配置。
 */
const PROTOCOL: Record<ChainId, { chainId: number; testnet: boolean }> = {
  eth: { chainId: 1, testnet: false },
  bsc: { chainId: 56, testnet: false },
  base: { chainId: 8453, testnet: false },
  "op-sepolia": { chainId: 11155420, testnet: true },
  // 2026-09-02 经 https://rpc.monad.xyz 实测 eth_chainId = 0x8f
  monad: { chainId: 143, testnet: false },
};

/** 问了一条租户没启用的链：调用方只应从 `enabledChains()` 里取链。 */
export class ChainNotEnabledError extends Error {
  constructor(readonly chain: ChainId) {
    super(`chain ${chain} is not enabled for this tenant`);
    this.name = "ChainNotEnabledError";
  }
}

let delivered: DeliveredWalletConfig | null = null;
const listeners = new Set<() => void>();

/**
 * 丢掉与协议事实不符的链。
 *
 * 宁可少一条链，也不能拿一个可疑的 chainId 去签名——那等于交出重放保护。
 * 静默接受是最坏的选项，所以这里也留下一条 warning。
 */
function withTrustedChainIds(networks: WalletNetwork[]): WalletNetwork[] {
  return networks.filter((network) => {
    const fact = PROTOCOL[network.id];
    if (network.chainId !== fact.chainId) {
      console.warn(
        `[wallet] 拒绝 ${network.id}：下发的 chainId ${network.chainId} 与协议事实 ${fact.chainId} 不一致`,
      );
      return false;
    }
    if (network.testnet !== fact.testnet) {
      console.warn(
        `[wallet] 拒绝 ${network.id}：下发的 testnet=${network.testnet} 与协议事实不一致`,
      );
      return false;
    }
    return true;
  });
}

/**
 * 只保留 https 的 RPC 端点。
 *
 * 服务端已经校验并过滤过两遍，这里是第三层——理由和 chainId 断言一样：
 * "必须是 https" 是客户端自己就能判断的协议事实，不需要任何配置知识。
 * 明文 RPC 的后果不只是泄露用户查询的每个地址和余额：中间人还能返回伪造的
 * 余额和回执，让界面显示一笔从未发生的转账已确认。
 *
 * 端点被全部丢掉时那条链的链上功能不可用（`rpcUrlsFor` 返回空），真链模式下
 * 这会以错误呈现，不会换成演示数据。
 */
function withHttpsEndpointsOnly(networks: WalletNetwork[]): WalletNetwork[] {
  return networks.map((network) => {
    const secure = network.rpcUrls.filter((url) =>
      url.trim().toLowerCase().startsWith("https://"),
    );
    if (secure.length !== network.rpcUrls.length)
      console.warn(
        `[wallet] 丢弃 ${network.id} 的非 https RPC 端点：明文 RPC 可被中间人伪造余额与回执`,
      );
    return { ...network, rpcUrls: secure };
  });
}

/**
 * 代币目录的客户端断言。服务端已经校验过一遍，这里是第二层——和 chainId、https
 * 一样，都是"客户端自己就能判断的事实"。**不符的条目一律拒绝并留痕，不修不补**：
 *
 * 1. 地址既不是 `native` 也不是合法地址：一个错的地址不会让用户丢钱，但会在列表里
 *    占一行并且永远是 0；
 * 2. `displayDecimals > decimals`：超过链上精度的位数是不存在的数字。服务端在写入时
 *    就拒绝它，出现在下发里只能是数据被改坏了；
 * 3. 同 (chain, address) 重复：服务端合并时已去重，重复只能是数据坏了，后一条拒绝。
 */
function withTrustedTokens(tokens: DeliveredToken[]): DeliveredToken[] {
  const seen = new Set<string>();
  const trusted: DeliveredToken[] = [];
  for (const token of tokens) {
    const address = token.address.trim();
    if (
      address !== NATIVE_TOKEN_ADDRESS &&
      classifyEvmAddress(address) !== "valid"
    ) {
      console.warn(
        `[wallet] 拒绝 ${token.chain} 上的代币 ${token.symbol}：地址 ${token.address} 不是合法的 EIP-55 地址`,
      );
      continue;
    }
    if (token.displayDecimals > token.decimals) {
      console.warn(
        `[wallet] 拒绝 ${token.chain} 上的 ${token.symbol}：展示精度 ${token.displayDecimals} 超过链上精度 ${token.decimals}`,
      );
      continue;
    }
    const key = `${token.chain}:${address.toLowerCase()}`;
    if (seen.has(key)) {
      console.warn(
        `[wallet] 拒绝 ${token.chain} 上重复的代币条目 ${token.address}`,
      );
      continue;
    }
    seen.add(key);
    trusted.push({
      ...token,
      // 存 EIP-55 形式：确认页会原样显示它，全小写会让用户失去校验和这道肉眼防线
      address:
        address === NATIVE_TOKEN_ADDRESS
          ? address
          : normalizeEvmAddress(address),
    });
  }
  return trusted;
}

export function applyDeliveredWalletConfig(config: {
  walletConnectProjectId: string;
  networks: WalletNetwork[];
  onchainSends: boolean;
  tokens: DeliveredToken[];
}): void {
  const next: DeliveredWalletConfig = {
    walletConnectProjectId: config.walletConnectProjectId.trim(),
    networks: withHttpsEndpointsOnly(withTrustedChainIds(config.networks)),
    onchainSends: config.onchainSends,
    tokens: withTrustedTokens(config.tokens),
  };
  // 监听者是 WalletConnect 客户端（projectId / 链变了要重建）。代币目录变了
  // 不需要重建它——余额的刷新由 runtime-context 单独触发
  const changed =
    delivered === null ||
    delivered.walletConnectProjectId !== next.walletConnectProjectId ||
    delivered.onchainSends !== next.onchainSends ||
    JSON.stringify(delivered.networks) !== JSON.stringify(next.networks);
  delivered = next;
  if (changed) for (const listener of listeners) listener();
}

/** projectId 变化时要丢弃已建的 WalletConnect 客户端，用这个订阅。 */
export function onWalletConfigChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function walletConnectProjectId(): string | null {
  const value = delivered?.walletConnectProjectId;
  return value ? value : null;
}

export function isWalletConnectConfigured(): boolean {
  return walletConnectProjectId() !== null;
}

/**
 * 租户启用的链——**界面上"有哪些链"的唯一来源**。
 *
 * 管理端钱包页勾掉一条链，服务端就不再下发它的 network。App 里任何列链的地方
 * （余额汇总、转出页、收款页、链筛选）都必须从这里取，而不是遍历 `CHAINS`。
 * 还没收到下发时为空。
 */
export function enabledChains(): ChainId[] {
  return walletNetworks().map((network) => network.id);
}

export function isChainEnabled(chain: ChainId): boolean {
  return walletNetworks().some((network) => network.id === chain);
}

export function walletNetworks(): WalletNetwork[] {
  return delivered?.networks ?? [];
}

function networkFor(chain: ChainId): WalletNetwork {
  const network = walletNetworks().find((item) => item.id === chain);
  if (!network) throw new ChainNotEnabledError(chain);
  return network;
}

/**
 * 这条链的 EIP-155 chain id。确认页要显示它——链名可以重名（Base 和 Ethereum 的
 * 原生币都叫 ETH），chainId 是唯一不会歧义的标识。协议事实，不依赖下发。
 */
export function evmChainIdOf(chain: ChainId): number {
  return PROTOCOL[chain].chainId;
}

/** 测试链：币没有价值，界面上任何显示这条链资产的地方都要标出来。协议事实。 */
export function isTestnetChain(chain: ChainId): boolean {
  return PROTOCOL[chain].testnet;
}

/** 区块浏览器上的地址页，按租户下发的浏览器地址。 */
export function explorerAddressUrl(chain: ChainId, address: string): string {
  return `${networkFor(chain).explorerUrl}/address/${address}`;
}

/**
 * 转出是否真的上链——租户级的显式开关。
 *
 * 不能用"有没有 RPC 端点"当开关：服务端对没配过端点的租户也会下发平台默认端点，
 * 那样新版本一发布，所有租户的主网转出就同时变成真钱，而余额还停在演示账本上。
 * 开着时任何链上失败都以错误呈现；关着时是显式的演示账本状态。
 */
export function onchainSendsEnabled(): boolean {
  return delivered?.onchainSends === true;
}

/** 链层（余额 / 广播）用的 RPC 端点；为空表示这条链没有可用端点。 */
export function rpcUrlsFor(chain: ChainId): string[] {
  return networkFor(chain).rpcUrls;
}

/**
 * 这条链上服务端下发的代币目录（含原生币条目），已经过客户端断言。
 * 真链上的代币列表**只**来自这里，不存在别的来源。
 */
export function deliveredTokens(chain: ChainId): DeliveredToken[] {
  return (delivered?.tokens ?? []).filter((token) => token.chain === chain);
}

/**
 * 原生币的展示精度：手续费、原生币余额都按它显示。
 *
 * 目录里的 native 条目说了算。服务端保证启用的链一定有启用的原生币条目
 * （原生币不能停用），所以找不到就是数据坏了，抛错而不是猜一个位数。
 */
export function nativeDisplayDecimals(chain: ChainId): number {
  const native = deliveredTokens(chain).find(
    (token) => token.address === NATIVE_TOKEN_ADDRESS,
  );
  if (!native)
    throw new Error(`token catalogue for ${chain} has no native entry`);
  return native.displayDecimals;
}

/** 仅供测试重置模块级状态。 */
export function resetDeliveredWalletConfig(): void {
  delivered = null;
}
