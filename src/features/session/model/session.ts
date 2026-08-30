import type { ChainId } from "../../../core/gateways/types";

export type WalletConnectorId =
  "embedded" | "metamask" | "okx" | "trust" | "walletconnect";

export type Session = {
  address: string;
  ens?: string;
  connector: WalletConnectorId;
  chains: ChainId[];
  /** ISO；到期后需重新签名登录 */
  expiresAt: string;
  signedInAt: string;
};

/** 登录被打断前用户想做的事，登录成功后回放。 */
export type AuthIntent =
  | { type: "open_order"; marketId: string; outcome: "yes" | "no" }
  | { type: "open_swap"; chain?: ChainId; tokenAddress?: string }
  | { type: "open_transfer" }
  | { type: "open_tab"; tab: "assets" | "positions" }
  | { type: "toggle_watchlist"; chain: ChainId; tokenAddress: string }
  | { type: "none" };
