import type { WalletConnectorId } from "../../session/model/session";

/** 钱包的展示名。连接器列表拿不到时（比如二维码 sheet）用它。 */
export const WALLET_NAMES: Partial<Record<WalletConnectorId, string>> = {
  metamask: "MetaMask",
  okx: "OKX Wallet",
  trust: "Trust Wallet",
  walletconnect: "WalletConnect",
};
