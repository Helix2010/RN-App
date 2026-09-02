import { fromDecimal, money, type Money } from "../core/money/money";
import type { FaucetStatus } from "../core/predict-platform/faucet";
import {
  PredictNotEnabledError,
  enablementComplete,
  type DepositAsset,
  type DepositStep,
  type EnablementStep,
  type PendingWithdrawal,
  type PredictAccountBalance,
  type PredictAccountGateway,
  type PredictEnablement,
  type PredictWalletFunds,
  type UnwrapTerms,
} from "../features/predict/api/account-gateway";
import type { PredictTx } from "../features/predict/model/predict";

/**
 * 测试用的预测账户替身。**只在测试里存在**：生产接线只有 `HttpPredictAccountGateway`，
 * 没有平台关联时界面显示不可用，不用它顶上。
 *
 * 状态由测试显式搭：默认是"已配置但没启用"；`enable()` 把四步一次跑完；转入 / 转出
 * 直接改数字，转出产生一条 `claimableAt` 为 `delaySeconds` 之后的待领取记录。
 */
export class InMemoryPredictAccountGateway implements PredictAccountGateway {
  status: PredictEnablement = {
    configured: true,
    loggedIn: false,
    safe: null,
    clobKey: false,
    approved: false,
  };
  funds: PredictWalletFunds = {
    chain: "op-sepolia",
    usdc: fromDecimal("250", 6, "USDC"),
    usdw: fromDecimal("0", 6, "USDW"),
    native: fromDecimal("0.01", 18, "ETH"),
  };
  balance: PredictAccountBalance = {
    chain: "op-sepolia",
    safe: "0x79ec2b3b2C34b583c1a4c1408f45AC01B5731740",
    safeBalance: fromDecimal("0", 6, "USDW"),
    available: fromDecimal("0", 6, "USDW"),
    lockedInOrders: fromDecimal("0", 6, "USDW"),
  };
  terms: UnwrapTerms = {
    delaySeconds: 60,
    minAmount: fromDecimal("0.001", 6, "USDW"),
  };
  pending: PendingWithdrawal[] = [];
  faucet: FaucetStatus = {
    claimed: false,
    safeCreated: true,
    dailyRemaining: 10,
    amountWei: "1000000000000000",
  };
  depositFee: Money = fromDecimal("0.0001", 18, "ETH");
  now = () => Date.now();
  readonly txs = new Map<string, PredictTx>();
  readonly calls: string[] = [];
  private sequence = 0;

  private requireEnabled(): void {
    if (!enablementComplete(this.status))
      throw new PredictNotEnabledError(this.status);
  }

  private tx(
    kind: PredictTx["kind"],
    status: PredictTx["status"] = "confirmed",
  ): PredictTx {
    this.sequence += 1;
    const tx: PredictTx = {
      id: `0x${this.sequence.toString(16).padStart(64, "0")}`,
      kind,
      status,
      hash: `0x${this.sequence.toString(16).padStart(64, "0")}`,
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.txs.set(tx.id, tx);
    return tx;
  }

  async enablement(): Promise<PredictEnablement> {
    return this.status;
  }

  async enable(
    _address: string,
    onStep?: (step: EnablementStep) => void,
  ): Promise<PredictEnablement> {
    this.calls.push("enable");
    for (const step of ["login", "deploySafe", "clobKey", "approve"] as const)
      onStep?.(step);
    this.status = {
      configured: true,
      loggedIn: true,
      safe: { address: this.balance.safe, deployed: true },
      clobKey: true,
      approved: true,
    };
    return this.status;
  }

  async getBalance(): Promise<PredictAccountBalance> {
    this.requireEnabled();
    return this.balance;
  }

  async walletFunds(): Promise<PredictWalletFunds> {
    return this.funds;
  }

  async unwrapTerms(): Promise<UnwrapTerms> {
    return this.terms;
  }

  async quoteDeposit(): Promise<Money> {
    this.requireEnabled();
    return this.depositFee;
  }

  async deposit(
    _address: string,
    input: { asset: DepositAsset; amount: Money },
    onStep?: (step: DepositStep) => void,
  ): Promise<PredictTx> {
    this.requireEnabled();
    this.calls.push(`deposit:${input.asset}:${input.amount.raw}`);
    if (input.asset === "USDC") {
      onStep?.("approve");
      onStep?.("wrap");
      this.funds = {
        ...this.funds,
        usdc: money(
          BigInt(this.funds.usdc.raw) - BigInt(input.amount.raw),
          6,
          "USDC",
        ),
      };
    } else {
      onStep?.("transfer");
      this.funds = {
        ...this.funds,
        usdw: money(
          BigInt(this.funds.usdw.raw) - BigInt(input.amount.raw),
          6,
          "USDW",
        ),
      };
    }
    const credited =
      BigInt(this.balance.safeBalance.raw) + BigInt(input.amount.raw);
    this.balance = {
      ...this.balance,
      safeBalance: money(credited, 6, "USDW"),
      available: money(
        BigInt(this.balance.available.raw) + BigInt(input.amount.raw),
        6,
        "USDW",
      ),
    };
    return this.tx("deposit", "submitted");
  }

  async withdraw(_address: string, amount: Money): Promise<PendingWithdrawal> {
    this.requireEnabled();
    this.calls.push(`withdraw:${amount.raw}`);
    const pending: PendingWithdrawal = {
      requestId: String(this.pending.length + 1),
      amount,
      assetAmount: money(amount.raw, 6, "USDC"),
      claimableAt: new Date(
        this.now() + this.terms.delaySeconds * 1000,
      ).toISOString(),
      initTxHash: `0x${"ab".repeat(32)}`,
      source: "local",
    };
    this.pending = [...this.pending, pending];
    this.balance = {
      ...this.balance,
      safeBalance: money(
        BigInt(this.balance.safeBalance.raw) - BigInt(amount.raw),
        6,
        "USDW",
      ),
      available: money(
        BigInt(this.balance.available.raw) - BigInt(amount.raw),
        6,
        "USDW",
      ),
    };
    return pending;
  }

  async listPendingWithdrawals(): Promise<PendingWithdrawal[]> {
    this.requireEnabled();
    return this.pending;
  }

  async claimWithdrawal(
    _address: string,
    requestId: string,
  ): Promise<PredictTx> {
    this.requireEnabled();
    this.calls.push(`claim:${requestId}`);
    const item = this.pending.find((entry) => entry.requestId === requestId);
    if (!item) throw new Error(`withdrawal ${requestId} is not pending`);
    this.pending = this.pending.filter(
      (entry) => entry.requestId !== requestId,
    );
    this.funds = {
      ...this.funds,
      usdc: money(
        BigInt(this.funds.usdc.raw) + BigInt(item.assetAmount.raw),
        6,
        "USDC",
      ),
    };
    return this.tx("withdraw");
  }

  async getTx(id: string): Promise<PredictTx | null> {
    const tx = this.txs.get(id);
    if (!tx) return null;
    if (tx.status === "submitted") {
      const confirmed = { ...tx, status: "confirmed" as const };
      this.txs.set(id, confirmed);
      return confirmed;
    }
    return tx;
  }

  async faucetStatus(): Promise<FaucetStatus> {
    return this.faucet;
  }

  async claimFaucet(): Promise<void> {
    this.calls.push("faucet");
    this.faucet = { ...this.faucet, claimed: true };
  }

  async forgetCredentials(): Promise<void> {
    this.calls.push("forget");
    this.status = { ...this.status, loggedIn: false, clobKey: false };
  }
}
