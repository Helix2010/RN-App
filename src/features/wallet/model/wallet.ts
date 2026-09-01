import type { ChainId, TokenRef, Tx } from "../../../core/gateways/types";
import type { Money } from "../../../core/money/money";
import type { WalletConnectorId } from "../../session/model/session";

export type WalletConnector = {
  id: WalletConnectorId;
  name: string;
  kind: "embedded" | "external";
  /** 租户配了 WalletConnect projectId 才能连；false 时 UI 置灰 */
  configured: boolean;
  /** 这个钱包 App 装在本机没有。false 只改文案：点了走扫码，不禁用 */
  installed: boolean;
  logoColor: string;
};

export type WalletAccount = {
  address: string;
  label: string;
  connector: WalletConnectorId;
  chains: ChainId[];
  current: boolean;
  /** 仅内置钱包有意义；外部钱包视为 true */
  backedUp: boolean;
};

export type TokenBalance = {
  token: TokenRef;
  amount: Money;
  usdValue: number;
  change24hPct: number;
};

export type SendRequest = {
  from: string;
  to: string;
  token: TokenRef;
  amount: Money;
};

export type WalletTransfer = Tx & {
  kind: "send" | "receive";
  token: TokenRef;
  amount: Money;
  counterparty: string;
};
