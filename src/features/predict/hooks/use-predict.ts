import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGateways } from "../../../core/gateways/gateway-context";
import {
  fromDecimal,
  toDecimalString,
  type Money,
} from "../../../core/money/money";
import type {
  EventQuery,
  LeaderboardPeriod,
  PlaceOrderRequest,
  PriceRange,
} from "../model/predict";

export function usePredictTags() {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-tags"],
    queryFn: () => predict.listTags(),
    staleTime: 10 * 60_000,
  });
}

export function usePredictEvents(query: EventQuery) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-events", query],
    queryFn: () => predict.listEvents(query),
    staleTime: 10_000,
  });
}

export function usePredictEvent(slugOrId: string | undefined) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-event", slugOrId],
    queryFn: () => predict.getEvent(slugOrId as string),
    enabled: Boolean(slugOrId),
    staleTime: 10_000,
  });
}

export function useOrderBook(marketId: string | undefined) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-book", marketId],
    queryFn: () => predict.getOrderBook(marketId as string),
    enabled: Boolean(marketId),
    refetchInterval: 5_000,
  });
}

export function usePriceHistory(
  marketId: string | undefined,
  range: PriceRange,
) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-history", marketId, range],
    queryFn: () => predict.getPriceHistory(marketId as string, range),
    enabled: Boolean(marketId),
    staleTime: 30_000,
  });
}

export function useAdjudication(marketId: string | undefined) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-adjudication", marketId],
    queryFn: () => predict.getAdjudication(marketId as string),
    enabled: Boolean(marketId),
    refetchInterval: 15_000,
  });
}

export function usePredictBalance(address: string | undefined) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["balance", address],
    queryFn: () => predict.getBalance(address as string),
    enabled: Boolean(address),
    staleTime: 5_000,
  });
}

export function useOrderPreview(
  address: string | undefined,
  request: PlaceOrderRequest | null,
) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-preview", address, request],
    queryFn: () =>
      predict.previewOrder(address as string, request as PlaceOrderRequest),
    enabled: Boolean(address && request),
    staleTime: 2_000,
  });
}

function useInvalidateAccount() {
  const queryClient = useQueryClient();
  return (address: string) => {
    for (const key of [
      "balance",
      "positions",
      "orders",
      "activity",
      "assets",
      "predict-pnl",
    ])
      void queryClient.invalidateQueries({ queryKey: [key, address] });
    void queryClient.invalidateQueries({ queryKey: ["assets"] });
    void queryClient.invalidateQueries({ queryKey: ["predict-events"] });
    void queryClient.invalidateQueries({ queryKey: ["predict-event"] });
    void queryClient.invalidateQueries({ queryKey: ["predict-book"] });
    void queryClient.invalidateQueries({ queryKey: ["predict-adjudication"] });
  };
}

export function usePlaceOrder(address: string | undefined) {
  const { predict } = useGateways();
  const invalidate = useInvalidateAccount();
  return useMutation({
    mutationFn: (request: PlaceOrderRequest) =>
      predict.placeOrder(address as string, request),
    onSuccess: () => address && invalidate(address),
  });
}

export function useOpenOrders(address: string | undefined, marketId?: string) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["orders", address, marketId ?? "all"],
    queryFn: () => predict.listOpenOrders(address as string, marketId),
    enabled: Boolean(address),
  });
}

export function useCancelOrder(address: string | undefined) {
  const { predict } = useGateways();
  const invalidate = useInvalidateAccount();
  return useMutation({
    mutationFn: (orderId: string) =>
      predict.cancelOrder(address as string, orderId),
    onSuccess: () => address && invalidate(address),
  });
}

export function usePositions(
  address: string | undefined,
  includeClosed = false,
) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["positions", address, includeClosed],
    queryFn: () => predict.listPositions(address as string, { includeClosed }),
    enabled: Boolean(address),
    staleTime: 5_000,
  });
}

export function usePredictActivity(address: string | undefined) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["activity", address],
    queryFn: () => predict.listActivity(address as string),
    enabled: Boolean(address),
  });
}

export function useRedeem(address: string | undefined) {
  const { predict } = useGateways();
  const invalidate = useInvalidateAccount();
  return useMutation({
    mutationFn: (positionIds: string[]) =>
      predict.redeem(address as string, positionIds),
    onSuccess: () => address && invalidate(address),
  });
}

export function useSplitMerge(address: string | undefined) {
  const { predict } = useGateways();
  const invalidate = useInvalidateAccount();
  return useMutation({
    mutationFn: (input: {
      marketId: string;
      direction: "split" | "merge";
      amount: Money;
    }) =>
      predict.splitOrMerge(
        address as string,
        input.marketId,
        input.direction,
        input.amount,
      ),
    onSuccess: () => address && invalidate(address),
  });
}

/** 钱包 → 预测账户：先扣钱包，再入预测账户；任一步失败即抛错（Mock 内不做补偿）。 */
export function usePredictDeposit(address: string | undefined) {
  const { predict, wallet } = useGateways();
  const invalidate = useInvalidateAccount();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      amount: Money;
      walletToken: Parameters<typeof wallet.adjustBalance>[1];
    }) => {
      const walletAmount = fromDecimal(
        toDecimalString(input.amount),
        input.walletToken.decimals,
        input.walletToken.symbol,
      );
      const debit = {
        ...walletAmount,
        raw: (-BigInt(walletAmount.raw)).toString(),
      };
      await wallet.adjustBalance(address as string, input.walletToken, debit);
      try {
        return await predict.deposit(address as string, input.amount);
      } catch (error) {
        // 两个网关的组合不是原子的：预测账户入账失败时把钱包扣减退回
        await wallet.adjustBalance(
          address as string,
          input.walletToken,
          walletAmount,
        );
        throw error;
      }
    },
    onSuccess: () => {
      if (address) invalidate(address);
      void queryClient.invalidateQueries({ queryKey: ["wallet-balances"] });
    },
  });
}

export function usePredictWithdraw(address: string | undefined) {
  const { predict, wallet } = useGateways();
  const invalidate = useInvalidateAccount();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      amount: Money;
      walletToken: Parameters<typeof wallet.adjustBalance>[1];
    }) => {
      const tx = await predict.withdraw(address as string, input.amount);
      const credit = fromDecimal(
        toDecimalString(input.amount),
        input.walletToken.decimals,
        input.walletToken.symbol,
      );
      try {
        await wallet.adjustBalance(
          address as string,
          input.walletToken,
          credit,
        );
      } catch (error) {
        // 钱包入账失败：把预测账户扣减退回，避免资金消失
        await predict.deposit(address as string, input.amount);
        throw error;
      }
      return tx;
    },
    onSuccess: () => {
      if (address) invalidate(address);
      void queryClient.invalidateQueries({ queryKey: ["wallet-balances"] });
    },
  });
}

export function useSubmitDispute(address: string | undefined) {
  const { predict } = useGateways();
  const invalidate = useInvalidateAccount();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { marketId: string; reason: string }) =>
      predict.submitDispute(address as string, input.marketId, input.reason),
    onSuccess: (_result, input) => {
      if (address) invalidate(address);
      void queryClient.invalidateQueries({
        queryKey: ["predict-adjudication", input.marketId],
      });
    },
  });
}

export function useLeaderboard(
  period: LeaderboardPeriod,
  sort: "pnl" | "volume",
) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-leaderboard", period, sort],
    queryFn: () => predict.getLeaderboard(period, sort),
    staleTime: 60_000,
  });
}

/** 轮询一笔预测账户交易直到终态。 */
export function usePredictTx(id: string | undefined) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-tx", id],
    queryFn: () => predict.getTx(id as string),
    enabled: Boolean(id),
    refetchInterval: (query) =>
      query.state.data &&
      (query.state.data.status === "confirmed" ||
        query.state.data.status === "failed")
        ? false
        : 800,
  });
}
