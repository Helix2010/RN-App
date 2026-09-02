import { enabledChains } from "../../../core/wallet/config/wallet-runtime-config";
import type { TokenBalance } from "../../wallet/model/wallet";
import { toApproxNumber } from "../../../core/money/money";
import {
  PredictNotEnabledError,
  type PredictAccountGateway,
} from "../../predict/api/account-gateway";
import { PredictServiceNotConfiguredError } from "../../../core/predict-platform/config";
import type { WalletGateway } from "../../wallet/api/gateway";
import type { AssetsGateway, AssetsOverview } from "./gateway";

/** 资产总览 = 钱包余额 + 预测账户（真实平台）的聚合，不持有自己的状态。 */
export class AssetsOverviewGateway implements AssetsGateway {
  constructor(
    private readonly wallet: WalletGateway,
    private readonly predictAccount: PredictAccountGateway,
  ) {}

  async getOverview(
    address: string,
    options: { includePredict: boolean },
  ): Promise<AssetsOverview> {
    const [snapshot, predict] = await Promise.all([
      this.wallet.getBalances(address),
      options.includePredict
        ? this.predictSummary(address)
        : Promise.resolve(null),
    ]);
    const holdings = snapshot.items;
    // 合计只算有估值的持仓：没有参考价的币不是 0，是不知道；这时合计是"部分合计"
    const priced = holdings.filter(
      (item): item is TokenBalance & { usdValue: number } =>
        item.usdValue !== null,
    );
    const walletUsd = priced.reduce((sum, item) => sum + item.usdValue, 0);
    const walletChange = priced.reduce(
      (sum, item) => sum + (item.usdValue * item.change24hPct) / 100,
      0,
    );
    // 链数按租户启用的链算，扣掉这次不可用的；不按"哪些链恰好返回了条目"
    const chains = enabledChains().length - snapshot.unavailable.length;
    const partial =
      snapshot.unavailable.length > 0 || priced.length < holdings.length;
    const totalUsd =
      walletUsd + (predict?.status === "enabled" ? predict.usd : 0);
    const change24hUsd = walletChange;
    return {
      totalUsd,
      change24hUsd,
      change24hPct:
        totalUsd > 0 ? (change24hUsd / (totalUsd - change24hUsd)) * 100 : 0,
      wallet: { usd: walletUsd, chains, address },
      predict,
      holdings,
      unavailable: snapshot.unavailable,
      partial,
    };
  }

  /** 未启用不是错误，是账户的一种状态；其它错误原样抛出。 */
  private async predictSummary(
    address: string,
  ): Promise<AssetsOverview["predict"]> {
    try {
      const balance = await this.predictAccount.getBalance(address);
      return {
        status: "enabled",
        chain: balance.chain,
        available: balance.available,
        lockedInOrders: balance.lockedInOrders,
        safeBalance: balance.safeBalance,
        // USDW 由 wrapper 合约按 1:1 兑 USDC 铸销，估值按 1 美元
        usd: toApproxNumber(balance.safeBalance),
      };
    } catch (error) {
      if (error instanceof PredictNotEnabledError)
        return { status: "not-enabled" };
      // 模块开了但租户没配平台关联：预测账户不可用（null），钱包部分照常显示
      if (error instanceof PredictServiceNotConfiguredError) return null;
      throw error;
    }
  }
}
