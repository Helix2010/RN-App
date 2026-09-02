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
    // 没有参考价的币不进合计：合计是"已知估值之和"，不是把不知道的当 0
    const walletUsd = holdings.reduce(
      (sum, item) => sum + (item.usdValue ?? 0),
      0,
    );
    const walletChange = holdings.reduce(
      (sum, item) => sum + ((item.usdValue ?? 0) * item.change24hPct) / 100,
      0,
    );
    const chains = new Set(holdings.map((item) => item.token.chain)).size;
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
    };
  }
}
