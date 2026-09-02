import type { ChainId } from "../../../core/gateways/types";
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
  /**
   * 预测账户（真实平台）。null = 模块关闭；`not-enabled` = 这个地址还没完成启用
   * （登录 / Safe / 密钥 / 授权四步）；`enabled` 时余额来自 Safe 里的 USDW 与 clob 的可用额度。
   */
  predict:
    | {
        status: "enabled";
        chain: ChainId;
        safe: string;
        usd: number;
        available: Money;
        lockedInOrders: Money;
        safeBalance: Money;
      }
    | { status: "not-enabled" }
    | null;
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
