import type { ChainId, TokenRef, Tx } from "../../../core/gateways/types";
import type { MnemonicWordCount } from "../../../core/wallet/keygen/mnemonic";
import type { WalletSigner } from "../../../core/wallet/signer/types";
import type { Money } from "../../../core/money/money";
import {
  WalletVaultCorruptedError,
  WalletVaultKeyMissingError,
} from "../../../core/wallet/vault/keystore-vault";
import type { WalletConnectorId } from "../../session/model/session";
import type {
  BalanceSnapshot,
  SendRequest,
  TransferQuote,
  WalletAccount,
  WalletConnector,
  WalletTransfer,
  WalletTransferFeed,
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

/** 本机账户注册表读不出来（JSON 损坏 / 版本不认识）。原文不会被覆盖，走恢复流程。 */
export class WalletRegistryCorruptedError extends Error {
  constructor() {
    super(
      "stored wallet account registry is corrupted or has an unknown version",
    );
    this.name = "WalletRegistryCorruptedError";
  }
}

/**
 * 本机钱包存储为什么需要恢复：
 * - `corrupted`：vault 文件或账户注册表读不出来；
 * - `key-missing`：vault 有账户但密钥库里的 WK 丢了或对不上。
 * 两种情况都不能在原地创建 / 导入，UI 必须转去恢复面板。
 */
export type WalletRecoveryReason = "corrupted" | "key-missing";

export function recoveryReasonOf(error: unknown): WalletRecoveryReason | null {
  if (
    error instanceof WalletVaultCorruptedError ||
    error instanceof WalletRegistryCorruptedError
  )
    return "corrupted";
  if (error instanceof WalletVaultKeyMissingError) return "key-missing";
  return null;
}

/** `recoverStorage` 实际归档了什么；两项都是 false 表示存储本来就健康，什么都没动。 */
export type WalletStorageRecovery = {
  vaultArchived: boolean;
  registryArchived: boolean;
};

export interface WalletGateway {
  listConnectors(): Promise<WalletConnector[]>;
  listAccounts(): Promise<WalletAccount[]>;
  connect(connector: WalletConnectorId): Promise<WalletAccount>;
  disconnect(address: string): Promise<void>;
  switchAccount(address: string): Promise<WalletAccount>;
  /** 本地显示名 */
  rename(address: string, label: string): Promise<void>;
  markBackedUp(address: string): Promise<void>;
  /** 按链分别报错：一条链查不到只影响它自己，见 BalanceSnapshot.unavailable */
  getBalances(address: string, chain?: ChainId): Promise<BalanceSnapshot>;
  /** 供 Predict 存入 / DEX 兑换扣减或增加钱包余额（Mock 内部账本）。 */
  adjustBalance(address: string, token: TokenRef, delta: Money): Promise<void>;
  /**
   * 这个账户的签名器（内置钱包或外部钱包）。预测平台的 EIP-712 登录、Safe 交易签名
   * 和合约调用都要它；业务层拿到的只是签名结果，永远拿不到私钥。
   */
  signerFor(address: string): Promise<WalletSigner>;
  /** `reason` 会显示在系统身份验证弹窗 / 外部钱包确认页上 */
  signMessage(
    address: string,
    message: string,
    options?: { reason?: string },
  ): Promise<string>;
  /** 生成新的自托管钱包；助记词只在此处返回一次供备份展示 */
  /** `reason` 是认证弹窗文案的内置字典 key；vault 已有账户时新建必须先过身份验证 */
  /**
   * 这个金库有没有开口令保护（安全评审 N6）。开了之后拿到设备上的密钥也拿不走
   * 助记词，代价是换锁屏 / 重录指纹之后要靠口令才能重新打开。
   */
  isPassphraseProtected(): Promise<boolean>;
  /** 开启口令保护。`reason` 是系统验证弹窗文案的内置字典 key。只能开一次。 */
  enablePassphrase(passphrase: string, reason: string): Promise<void>;
  /** `words` 不传按默认的 24 词（安全评审 N29）；界面允许用户改成 12。 */
  createWallet(options?: {
    reason?: string;
    words?: MnemonicWordCount;
  }): Promise<{ account: WalletAccount; mnemonic: string }>;
  /**
   * 导入。vault 里已有账户时会先弹系统验证，`reason` 是弹窗文案；
   * 不传而 vault 非空即失败（网关不替调用方决定文案）。
   */
  importMnemonic(
    phrase: string,
    index?: number,
    options?: { reason?: string },
  ): Promise<WalletAccount>;
  importPrivateKey(
    privateKey: string,
    options?: { reason?: string },
  ): Promise<WalletAccount>;
  /** 导出助记词，必须通过身份验证 */
  revealMnemonic(address: string, reason: string): Promise<string>;
  /**
   * 把读不出来 / 解不开的本机存储归档到带时间戳的键下并清空原位，让用户能重新导入。
   * 只归档确实损坏的部分；健康的 vault 一律不动。归档 vault 前要过身份验证。
   */
  recoverStorage?(reason: string): Promise<WalletStorageRecovery>;
  send(request: SendRequest): Promise<WalletTransfer>;
  getTransaction(id: string): Promise<Tx | null>;
  listTransfers(address: string): Promise<WalletTransfer[]>;
  /** 记录页用：转账记录 + 平台收款索引的每链状态（见 WalletTransferFeed） */
  transferFeed(address: string): Promise<WalletTransferFeed>;
  /** 链上手续费预估；这条链没走真链时返回 null。 */
  quoteTransfer(request: SendRequest): Promise<TransferQuote | null>;
  /** 这条链上的转出会不会真的上链。界面要据此告诉用户这是真钱还是演示账本。 */
  sendsOnchain(chain: ChainId): boolean;
}
