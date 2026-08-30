import type { Money } from "../../../core/money/money";
import type { TokenBalance } from "../../wallet/model/wallet";

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
};

export interface AssetsGateway {
  getOverview(
    address: string,
    options: { includePredict: boolean },
  ): Promise<AssetsOverview>;
}
