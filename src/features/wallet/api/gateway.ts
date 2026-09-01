import type { ChainId, TokenRef, Tx } from "../../../core/gateways/types";
import type { Money } from "../../../core/money/money";
import type { WalletConnectorId } from "../../session/model/session";
import type {
  SendRequest,
  TokenBalance,
  TransferQuote,
  WalletAccount,
  WalletConnector,
  WalletTransfer,
} from "../model/wallet";

/** 自托管开通不适用于外部钱包连接器时抛出。 */
export class WalletProvisioningUnsupportedError extends Error {
  constructor(readonly connector: WalletConnectorId) {
    super(`connector ${connector} does not provision keys in this app`);
    this.name = "WalletProvisioningUnsupportedError";
  }
}

/** 本应用还没有任何自托管钱包时，`connect("embedded")` 抛出，UI 转去创建/导入。 */
export class WalletNotProvisionedError extends Error {
  constructor() {
    super("no self-custodial wallet has been created on this device");
    this.name = "WalletNotProvisionedError";
  }
}

export interface WalletGateway {
  listConnectors(): Promise<WalletConnector[]>;
  listAccounts(): Promise<WalletAccount[]>;
  connect(connector: WalletConnectorId): Promise<WalletAccount>;
  disconnect(address: string): Promise<void>;
  switchAccount(address: string): Promise<WalletAccount>;
  /** 本地显示名 */
  rename(address: string, label: string): Promise<void>;
  markBackedUp(address: string): Promise<void>;
  getBalances(address: string, chain?: ChainId): Promise<TokenBalance[]>;
  /** 供 Predict 存入 / DEX 兑换扣减或增加钱包余额（Mock 内部账本）。 */
  adjustBalance(address: string, token: TokenRef, delta: Money): Promise<void>;
  /** `reason` 会显示在系统身份验证弹窗 / 外部钱包确认页上 */
  signMessage(
    address: string,
    message: string,
    options?: { reason?: string },
  ): Promise<string>;
  /** 生成新的自托管钱包；助记词只在此处返回一次供备份展示 */
  createWallet(): Promise<{ account: WalletAccount; mnemonic: string }>;
  importMnemonic(phrase: string, index?: number): Promise<WalletAccount>;
  importPrivateKey(privateKey: string): Promise<WalletAccount>;
  /** 导出助记词，必须通过身份验证 */
  revealMnemonic(address: string, reason: string): Promise<string>;
  send(request: SendRequest): Promise<WalletTransfer>;
  getTransaction(id: string): Promise<Tx | null>;
  listTransfers(address: string): Promise<WalletTransfer[]>;
  /** 链上手续费预估；这条链没走真链时返回 null。 */
  quoteTransfer(request: SendRequest): Promise<TransferQuote | null>;
}
