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
};

type DeliveredWalletConfig = {
  walletConnectProjectId: string;
  chains: ChainId[];
  networks: WalletNetwork[];
};

/** 平台默认：链的展示元数据在客户端，端点等服务端下发。 */
const FALLBACK_CHAIN_IDS: Record<ChainId, number> = {
  eth: 1,
  bsc: 56,
  base: 8453,
};

function fallbackNetworks(chains: ChainId[]): WalletNetwork[] {
  return chains.map((id) => ({
    id,
    chainId: FALLBACK_CHAIN_IDS[id],
    rpcUrls: [],
    explorerUrl: CHAINS[id].explorerUrl,
  }));
}

let delivered: DeliveredWalletConfig | null = null;
const listeners = new Set<() => void>();

export function applyDeliveredWalletConfig(config: {
  walletConnectProjectId: string;
  chains?: ChainId[];
  networks?: WalletNetwork[];
}): void {
  const chains =
    config.networks?.map((network) => network.id) ??
    config.chains ??
    (["bsc", "eth", "base"] as ChainId[]);
  const next: DeliveredWalletConfig = {
    walletConnectProjectId: config.walletConnectProjectId.trim(),
    chains,
    networks: config.networks ?? fallbackNetworks(chains),
  };
  const changed =
    delivered === null ||
    delivered.walletConnectProjectId !== next.walletConnectProjectId ||
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
    }
  );
}

/** 区块浏览器上的地址页；服务端下发的地址优先。 */
export function explorerAddressUrl(chain: ChainId, address: string): string {
  return `${networkFor(chain).explorerUrl}/address/${address}`;
}

/** 链层（余额 / 广播）用的 RPC 端点；未下发时为空，调用方必须处理不可用。 */
export function rpcUrlsFor(chain: ChainId): string[] {
  return networkFor(chain).rpcUrls;
}

/** 仅供测试重置模块级状态。 */
export function resetDeliveredWalletConfig(): void {
  delivered = null;
}
