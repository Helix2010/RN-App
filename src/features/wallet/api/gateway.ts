import type {
  Chain,
  ChainId,
  TokenRef,
  Tx,
} from "../../../core/gateways/types";
import type { Money } from "../../../core/money/money";
import type { WalletConnectorId } from "../../session/model/session";
import type {
  SendRequest,
  TokenBalance,
  WalletAccount,
  WalletConnector,
  WalletTransfer,
} from "../model/wallet";

export interface WalletGateway {
  listChains(): Promise<Chain[]>;
  listConnectors(): Promise<WalletConnector[]>;
  listAccounts(): Promise<WalletAccount[]>;
  currentAccount(): Promise<WalletAccount | null>;
  connect(connector: WalletConnectorId): Promise<WalletAccount>;
  disconnect(address: string): Promise<void>;
  switchAccount(address: string): Promise<WalletAccount>;
  markBackedUp(address: string): Promise<void>;
  getBalances(address: string, chain?: ChainId): Promise<TokenBalance[]>;
  /** 供 Predict 存入 / DEX 兑换扣减或增加钱包余额（Mock 内部账本）。 */
  adjustBalance(address: string, token: TokenRef, delta: Money): Promise<void>;
  signMessage(address: string, message: string): Promise<string>;
  send(request: SendRequest): Promise<WalletTransfer>;
  getTransaction(id: string): Promise<Tx | null>;
  listTransfers(address: string): Promise<WalletTransfer[]>;
}
