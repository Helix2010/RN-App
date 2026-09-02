import type { ChainId } from "../../../core/gateways/types";
import type { Money } from "../../../core/money/money";
import type { PlatformAgreement } from "../../../core/predict-platform/agreements";
import type { FaucetStatus } from "../../../core/predict-platform/faucet";
import type { PredictTx } from "../model/predict";

/**
 * 预测账户（真实平台）：启用、余额、转入、两阶段转出。
 *
 * 这是接真实平台的契约，没有 Mock 实现——没配置平台关联时界面显示不可用，不用演示
 * 数据顶上。行情、下单、持仓仍在 `PredictGateway`，后续逐步接入。
 */

export type EnablementStep = "login" | "deploySafe" | "clobKey" | "approve";

export type PredictEnablement = {
  /** 平台关联已下发且 public-info 与之相符 */
  configured: boolean;
  loggedIn: boolean;
  safe: { address: string; deployed: boolean } | null;
  clobKey: boolean;
  approved: boolean;
};

export function enablementComplete(status: PredictEnablement): boolean {
  return (
    status.configured &&
    status.loggedIn &&
    status.safe !== null &&
    status.safe.deployed &&
    status.clobKey &&
    status.approved
  );
}

/** 交易余额 = Safe 里的 USDW；可用 / 冻结来自 clob（挂单占用）。 */
export type PredictAccountBalance = {
  /** 平台所在链（租户关联下发） */
  chain: ChainId;
  safeBalance: Money;
  available: Money;
  lockedInOrders: Money;
  safe: string;
};

/** EOA 在预测链上的资金：转入的来源与 gas。 */
export type PredictWalletFunds = {
  chain: ChainId;
  usdc: Money;
  usdw: Money;
  native: Money;
};

export type DepositAsset = "USDC" | "USDW";
export type DepositStep = "approve" | "wrap" | "transfer";

export type PendingWithdrawal = {
  requestId: string;
  /** 解包的 USDW */
  amount: Money;
  /** 到期可领的 USDC */
  assetAmount: Money;
  /** ISO 时间 */
  claimableAt: string;
  initTxHash: string;
  /** platform = 子图已索引；local = 本机乐观记录，子图还没追上 */
  source: "platform" | "local";
};

export type UnwrapTerms = { delaySeconds: number; minAmount: Money };

/** 平台协议：全部 + 本机还没接受的必读项（`required` 且版本不符） */
export type PredictAgreements = {
  all: PlatformAgreement[];
  pending: PlatformAgreement[];
};

export class PredictNotEnabledError extends Error {
  constructor(readonly status: PredictEnablement) {
    super("the prediction account is not enabled for this address");
    this.name = "PredictNotEnabledError";
  }
}

/**
 * 平台所在链在这个租户上不能发真实交易：租户处于演示账本状态（`wallet.onchainSends=false`）
 * 或没有下发端点。转入是 EOA 付 gas 的真实交易，与钱包转出走同一道开关。
 */
export class PredictChainUnavailableError extends Error {
  constructor(
    readonly chain: ChainId,
    readonly reason: "sends-disabled" | "no-endpoint",
  ) {
    super(
      reason === "sends-disabled"
        ? `on-chain sends are disabled for this tenant; cannot transact on ${chain}`
        : `no rpc endpoint delivered for ${chain}`,
    );
    this.name = "PredictChainUnavailableError";
  }
}

export interface PredictAccountGateway {
  enablement(address: string): Promise<PredictEnablement>;
  /** 跑完缺失的步骤（幂等）：每步开始前回调，供界面显示进度。 */
  enable(
    address: string,
    onStep?: (step: EnablementStep) => void,
  ): Promise<PredictEnablement>;
  getBalance(address: string): Promise<PredictAccountBalance>;
  walletFunds(address: string): Promise<PredictWalletFunds>;
  unwrapTerms(): Promise<UnwrapTerms>;
  /** 转入需要 gas：先估手续费给用户看。 */
  quoteDeposit(
    address: string,
    input: { asset: DepositAsset; amount: Money },
  ): Promise<Money>;
  deposit(
    address: string,
    input: { asset: DepositAsset; amount: Money },
    onStep?: (step: DepositStep) => void,
  ): Promise<PredictTx>;
  /** 阶段 A：发起解包；返回待领取记录 */
  withdraw(address: string, amount: Money): Promise<PendingWithdrawal>;
  listPendingWithdrawals(address: string): Promise<PendingWithdrawal[]>;
  /** 阶段 B：领取，USDC 回到 EOA */
  claimWithdrawal(address: string, requestId: string): Promise<PredictTx>;
  getTx(id: string): Promise<PredictTx | null>;
  agreements(): Promise<PredictAgreements>;
  /** 记下本机已接受这些协议的版本（与网页版一样只存本机） */
  acceptAgreements(items: PlatformAgreement[]): Promise<void>;
  faucetStatus(address: string): Promise<FaucetStatus>;
  claimFaucet(address: string): Promise<void>;
  /** 登出 / 切换地址：丢掉这个地址在当前平台的凭证 */
  forgetCredentials(address: string): Promise<void>;
}
