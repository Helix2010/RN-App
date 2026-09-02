import { CHAINS, type ChainId } from "../../gateways/types";

/**
 * 服务端在 bootstrap 里下发的钱包运行时参数。
 *
 * 这里**只有服务端这一条来源**，没有构建期兜底：projectId 与链端点都是租户
 * 配置而不是构建参数，混两条来源会让"某台机器能连、CI 出的包不能连"无法排查。
 * 拿不到下发值时用平台默认（`CHAINS` 里的展示元数据 + 空 RPC），并如实把依赖
 * 它的功能标为不可用。
 */

type WalletNetwork = {
  id: ChainId;
  /** EIP-155 chain id，签名与 WalletConnect namespace 都用它 */
  chainId: number;
  rpcUrls: string[];
  explorerUrl: string;
  /** 测试链。App 里要显式提示，别让用户当成主网用 */
  testnet: boolean;
};

type DeliveredWalletConfig = {
  walletConnectProjectId: string;
  chains: ChainId[];
  networks: WalletNetwork[];
  /** 转出是否真的上链。默认关：演示账本 */
  onchainSends: boolean;
};

/**
 * 每条链的 EIP-155 chain id。
 *
 * 这份常量有**两个不同的角色**，别当成重复配置删掉：
 * 1. 服务端没下发时的兜底值；
 * 2. **安全断言** —— 下发值必须与它一致，否则拒绝该条链。
 *
 * 第 2 点是纵深防御。chainId 是 EIP-155 重放保护的输入：如果服务端（或到
 * 服务端的链路）被篡改成另一条链的 id，用户签出的交易可以在那条链上重放。
 * 端点和 projectId 可以由租户随意配置，chainId 不行——它属于协议事实，
 * 不属于配置。
 */
const FALLBACK_CHAIN_IDS: Record<ChainId, number> = {
  eth: 1,
  bsc: 56,
  base: 8453,
  "op-sepolia": 11155420,
};

/** 测试链：币无价值，界面上要和主网区分。服务端下发这个标记。 */
const FALLBACK_TESTNETS: Record<ChainId, boolean> = {
  eth: false,
  bsc: false,
  base: false,
  "op-sepolia": true,
};

function fallbackNetworks(chains: ChainId[]): WalletNetwork[] {
  return chains.map((id) => ({
    id,
    chainId: FALLBACK_CHAIN_IDS[id],
    rpcUrls: [],
    explorerUrl: CHAINS[id].explorerUrl,
    testnet: FALLBACK_TESTNETS[id],
  }));
}

let delivered: DeliveredWalletConfig | null = null;
const listeners = new Set<() => void>();

/**
 * 丢掉 chainId 与协议事实不符的链。
 *
 * 宁可少一条链，也不能拿一个可疑的 chainId 去签名——那等于交出重放保护。
 * 静默接受是最坏的选项，所以这里也留下一条 warning。
 */
function withTrustedChainIds(networks: WalletNetwork[]): WalletNetwork[] {
  return networks.filter((network) => {
    const expected = FALLBACK_CHAIN_IDS[network.id];
    if (expected === undefined || network.chainId === expected) return true;
    console.warn(
      `[wallet] 拒绝 ${network.id}：下发的 chainId ${network.chainId} 与协议事实 ${expected} 不一致`,
    );
    return false;
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
 * 端点被全部丢掉时那条链的链上功能自然不可用（`rpcUrlsFor` 返回空），
 * 这是一个已定义的安全状态，不需要额外处理。
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

export function applyDeliveredWalletConfig(config: {
  walletConnectProjectId: string;
  chains?: ChainId[];
  networks?: WalletNetwork[];
  onchainSends?: boolean;
}): void {
  const trustedNetworks = config.networks
    ? withHttpsEndpointsOnly(withTrustedChainIds(config.networks))
    : undefined;
  const chains =
    trustedNetworks?.map((network) => network.id) ??
    config.chains ??
    (["bsc", "eth", "base"] as ChainId[]);
  const next: DeliveredWalletConfig = {
    walletConnectProjectId: config.walletConnectProjectId.trim(),
    chains,
    networks: trustedNetworks ?? fallbackNetworks(chains),
    onchainSends: config.onchainSends === true,
  };
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

function enabledChains(): ChainId[] {
  return delivered?.chains ?? ["bsc", "eth", "base"];
}

export function walletNetworks(): WalletNetwork[] {
  return delivered?.networks ?? fallbackNetworks(enabledChains());
}

function networkFor(chain: ChainId): WalletNetwork {
  return (
    walletNetworks().find((network) => network.id === chain) ?? {
      id: chain,
      chainId: FALLBACK_CHAIN_IDS[chain],
      rpcUrls: [],
      explorerUrl: CHAINS[chain].explorerUrl,
      testnet: FALLBACK_TESTNETS[chain],
    }
  );
}

/**
 * 这条链的 EIP-155 chain id。确认页要显示它——链名可以重名（Base 和 Ethereum 的
 * 原生币都叫 ETH），chainId 是唯一不会歧义的标识。
 */
export function evmChainIdOf(chain: ChainId): number {
  return networkFor(chain).chainId;
}

/** 区块浏览器上的地址页；服务端下发的地址优先。 */
export function explorerAddressUrl(chain: ChainId, address: string): string {
  return `${networkFor(chain).explorerUrl}/address/${address}`;
}

/**
 * 转出是否真的上链——租户级的显式开关，默认关。
 *
 * 不能用"有没有 RPC 端点"当开关：服务端对没配过端点的租户也会下发平台默认端点，
 * 那样新版本一发布，所有租户的主网转出就同时变成真钱，而余额还停在演示账本上。
 */
export function onchainSendsEnabled(): boolean {
  return delivered?.onchainSends === true;
}

/** 测试链：币没有价值，界面上任何显示这条链资产的地方都要标出来。 */
export function isTestnetChain(chain: ChainId): boolean {
  return networkFor(chain).testnet;
}

/** 链层（余额 / 广播）用的 RPC 端点；未下发时为空，调用方必须处理不可用。 */
export function rpcUrlsFor(chain: ChainId): string[] {
  return networkFor(chain).rpcUrls;
}

/** 仅供测试重置模块级状态。 */
export function resetDeliveredWalletConfig(): void {
  delivered = null;
}
