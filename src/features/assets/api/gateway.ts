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
};

export interface AssetsGateway {
  getOverview(
    address: string,
    options: { includePredict: boolean },
  ): Promise<AssetsOverview>;
}
