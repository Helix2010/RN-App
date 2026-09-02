import type { Money } from "../../../core/money/money";
import type {
  ChainBalanceFailure,
  TokenBalance,
} from "../../wallet/model/wallet";

export type AssetsOverview = {
  totalUsd: number;
  change24hUsd: number;
  change24hPct: number;
  wallet: { usd: number; chains: number; address: string };
  /** Predict 关闭或未登录时为 null */
  predict: {
    usd: number;
    available: Money;
    lockedInOrders: Money;
    positionsValueUsd: number;
    claimable: Money;
  } | null;
  holdings: TokenBalance[];
  /** 这次没拿到余额的链：总额与持仓里都不含它们，界面要单独说明 */
  unavailable: ChainBalanceFailure[];
  /** 总额是部分合计：有链不可用，或有持仓没有估值。界面不能把它当精确数字展示 */
  partial: boolean;
};

export interface AssetsGateway {
  getOverview(
    address: string,
    options: { includePredict: boolean },
  ): Promise<AssetsOverview>;
}
