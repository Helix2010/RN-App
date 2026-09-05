import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useGateways } from "../../../core/gateways/gateway-context";
import type { ChainId, TokenRef } from "../../../core/gateways/types";
import { toApproxNumber } from "../../../core/money/money";
import { PredictServiceNotConfiguredError } from "../../../core/predict-platform/config";
import {
  deliveredTokens,
  enabledChains,
} from "../../../core/wallet/config/wallet-runtime-config";
import { usePredictAccountBalance } from "../../predict/hooks/use-predict-account";
import type { BalanceSnapshot } from "../../wallet/model/wallet";
import {
  composeOverview,
  type AssetsOverview,
  type ChainResult,
  type PredictSummary,
} from "../model/overview";

export type {
  AssetRow,
  AssetsOverview,
  PredictSummary,
} from "../model/overview";

/**
 * 资产总览：每条启用的链一个独立查询（键与 `useWalletBalances(address, chain)` 相同，
 * 失效逻辑通用），预测账户另一个查询；任一到达就更新界面，不等最慢的那条链。
 * 币种目录来自下发配置，所以还没返回的链先列出币种、金额留白。
 */
export function useAssetsOverview(
  address: string | undefined,
  includePredict: boolean,
): {
  data: AssetsOverview | undefined;
  isRefetching: boolean;
  refetch: () => void;
} {
  const { wallet } = useGateways();
  const queryClient = useQueryClient();
  const chains = enabledChains();
  const balances = useQueries({
    queries: chains.map((chain) => ({
      queryKey: ["wallet-balances", address, chain],
      queryFn: (): Promise<BalanceSnapshot> =>
        wallet.getBalances(address as string, chain),
      enabled: Boolean(address),
      staleTime: 15_000,
    })),
  });
  const predict = usePredictAccountBalance(
    includePredict ? address : undefined,
  );

  const predictSummary: PredictSummary | undefined = !includePredict
    ? null
    : predict.data
      ? {
          status: "enabled",
          chain: predict.data.chain,
          available: predict.data.available,
          lockedInOrders: predict.data.lockedInOrders,
          safeBalance: predict.data.safeBalance,
          // USDW 由 wrapper 合约按 1:1 兑 USDC 铸销，估值按 1 美元
          usd: toApproxNumber(predict.data.safeBalance),
        }
      : predict.notEnabled
        ? { status: "not-enabled" }
        : predict.error instanceof PredictServiceNotConfiguredError
          ? null
          : undefined;

  // 逐链拼装很便宜（几十行），不做 memo：useQueries 每次渲染返回新数组，依赖数组也稳不住
  const byChain = new Map<ChainId, ChainResult>();
  chains.forEach((chain, index) => {
    const query = balances[index];
    byChain.set(
      chain,
      query?.data
        ? { status: "ready", snapshot: query.data }
        : query?.error
          ? { status: "error", error: query.error }
          : { status: "loading" },
    );
  });
  const data = address
    ? composeOverview({
        address,
        chains,
        catalogue: (chain): TokenRef[] =>
          deliveredTokens(chain).map((token) => ({
            ...token,
            verified: false,
          })),
        results: (chain) => byChain.get(chain) ?? { status: "loading" },
        predict: predictSummary,
      })
    : undefined;

  return {
    data,
    isRefetching:
      balances.some((query) => query.isRefetching) || predict.isRefetching,
    refetch: () => {
      void queryClient.invalidateQueries({
        queryKey: ["wallet-balances", address],
      });
      if (includePredict) void predict.refetch();
    },
  };
}
