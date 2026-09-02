import { enabledChains } from "../../../core/wallet/config/wallet-runtime-config";
import type { TokenBalance } from "../../wallet/model/wallet";
import { toApproxNumber } from "../../../core/money/money";
import type { PredictGateway } from "../../predict/api/gateway";
import type { WalletGateway } from "../../wallet/api/gateway";
import type { AssetsGateway, AssetsOverview } from "./gateway";

/** 资产总览 = 钱包余额 + 预测账户 的聚合，不持有自己的状态。 */
export class MockAssetsGateway implements AssetsGateway {
  constructor(
    private readonly wallet: WalletGateway,
    private readonly predict: PredictGateway,
  ) {}

  async getOverview(
    address: string,
    options: { includePredict: boolean },
  ): Promise<AssetsOverview> {
    const [snapshot, predictBalance] = await Promise.all([
      this.wallet.getBalances(address),
      options.includePredict
        ? this.predict.getBalance(address)
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
    const predict = predictBalance
      ? {
          available: predictBalance.available,
          lockedInOrders: predictBalance.lockedInOrders,
          claimable: predictBalance.claimable,
          positionsValueUsd: toApproxNumber(predictBalance.positionsValue),
          usd:
            toApproxNumber(predictBalance.available) +
            toApproxNumber(predictBalance.lockedInOrders) +
            toApproxNumber(predictBalance.positionsValue),
        }
      : null;
    const totalUsd = walletUsd + (predict?.usd ?? 0);
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
}
