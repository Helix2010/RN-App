import type { BootstrapConfig } from "../core/config/bootstrap.schema";
import { CHAINS, type ChainId } from "../core/gateways/types";
import type {
  DeliveredToken,
  WalletNetwork,
} from "../core/wallet/config/wallet-runtime-config";

/**
 * 测试用的租户钱包配置。
 *
 * 生产里这段只来自服务端下发；测试必须显式搭出"这个租户启用了哪些链、开没开
 * 真链、目录里有什么"，而不是依赖代码里的默认值——代码里没有默认值。
 */

const PROTOCOL: Record<ChainId, { chainId: number; testnet: boolean }> = {
  eth: { chainId: 1, testnet: false },
  bsc: { chainId: 56, testnet: false },
  base: { chainId: 8453, testnet: false },
  "op-sepolia": { chainId: 11155420, testnet: true },
  monad: { chainId: 143, testnet: false },
};

export function tenantNetwork(
  id: ChainId,
  rpcUrls: string[] = [],
): WalletNetwork {
  return {
    id,
    chainId: PROTOCOL[id].chainId,
    rpcUrls,
    explorerUrl: CHAINS[id].explorerUrl,
    testnet: PROTOCOL[id].testnet,
  };
}

/** 一条链的原生币目录条目。服务端保证启用的链一定有它（原生币不能停用）。 */
export function nativeEntry(
  chain: ChainId,
  displayDecimals = 4,
): DeliveredToken {
  return {
    chain,
    address: "native",
    symbol: CHAINS[chain].nativeSymbol,
    name: CHAINS[chain].nativeSymbol,
    decimals: CHAINS[chain].nativeDecimals,
    displayDecimals,
    logoColor: CHAINS[chain].color,
  };
}

export type TenantWalletOptions = {
  /** 启用的链；不传时是三条主网 */
  chains?: ChainId[];
  /** 各链的 RPC 端点；不传的链没有端点 */
  rpc?: Partial<Record<ChainId, string[]>>;
  onchainSends?: boolean;
  /** 原生币之外的目录条目；每条启用的链的原生币条目总是带上 */
  tokens?: DeliveredToken[];
  walletConnectProjectId?: string;
};

export function tenantWallet(
  options: TenantWalletOptions = {},
): BootstrapConfig["wallet"] {
  const chains = options.chains ?? ["bsc", "eth", "base"];
  return {
    walletConnectProjectId: options.walletConnectProjectId ?? "",
    onchainSends: options.onchainSends ?? false,
    networks: chains.map((id) => tenantNetwork(id, options.rpc?.[id] ?? [])),
    tokens: [...chains.map((id) => nativeEntry(id)), ...(options.tokens ?? [])],
  };
}

/** `renderWithProviders` 的 `config` 选项里用：换掉租户的钱包段。 */
export function withWallet(
  config: BootstrapConfig,
  options: TenantWalletOptions,
): BootstrapConfig {
  return { ...config, wallet: tenantWallet(options) };
}
