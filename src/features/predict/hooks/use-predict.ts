import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { Page } from "../../../core/gateways/types";
import { useGateways } from "../../../core/gateways/gateway-context";
import { PREDICT_ACCOUNT_KEY } from "./use-predict-account";
import type { Money } from "../../../core/money/money";
import type {
  EventQuery,
  LeaderboardPeriod,
  OrderBook,
  PlaceOrderRequest,
  PredictEvent,
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

/**
 * 订阅一批市场的实时行情（clob-ws）：订单簿写入 `predict-book`，价格写回已缓存的事件与事件列表，
 * 界面不用额外状态。没有市场时不建连接；id 集合变化时重新订阅。
 */
export function useMarketStream(marketIds: string[]) {
  const { predict } = useGateways();
  const queryClient = useQueryClient();
  const key = marketIds.join(",");
  useEffect(() => {
    if (!key) return;
    return predict.subscribeMarkets(key.split(","), (event) => {
      if (event.type === "book") {
        // WS 簿事件不带 min_order_size，网关只能按 gamma 兜底；REST 拉到过的值更准，保留
        queryClient.setQueryData<OrderBook>(
          ["predict-book", event.book.marketId],
          (old) => ({
            ...event.book,
            minOrderShares: old?.minOrderShares ?? event.book.minOrderShares,
          }),
        );
        return;
      }
      const patch = (item: PredictEvent): PredictEvent =>
        item.markets.some((market) => market.id === event.marketId)
          ? {
              ...item,
              markets: item.markets.map((market) =>
                market.id === event.marketId
                  ? { ...market, yesPriceCents: event.yesPriceCents }
                  : market,
              ),
            }
          : item;
      queryClient.setQueriesData<PredictEvent>(
        { queryKey: ["predict-event"] },
        (old) => (old ? patch(old) : old),
      );
      queryClient.setQueriesData<Page<PredictEvent>>(
        { queryKey: ["predict-events"] },
        (old) => {
          if (!old) return old;
          const items = old.items.map(patch);
          return items.some((item, i) => item !== old.items[i])
            ? { ...old, items }
            : old;
        },
      );
    });
  }, [key, predict, queryClient]);
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

/** 该市场（YES 代币）的手续费 bps，来自 clob `/fee-rate`；事件级没有费率 */
export function useFeeBps(marketId: string | undefined) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-fee", marketId],
    queryFn: () => predict.getFeeBps(marketId as string),
    enabled: Boolean(marketId),
    staleTime: 10 * 60_000,
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
    // 下单 / 撤单改变 clob 的可用 / 冻结，账户余额查询挂在 predict-account 键下
    void queryClient.invalidateQueries({
      queryKey: [PREDICT_ACCOUNT_KEY, "balance", address],
    });
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

/** 盈亏曲线（data-service `/user-pnl`）；"今日"= 1d 序列末值 − 首值 */
export function usePredictPnl(address: string | undefined, range: PriceRange) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-pnl", address, range],
    queryFn: () => predict.getPnl(address as string, range),
    enabled: Boolean(address),
    staleTime: 60_000,
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
