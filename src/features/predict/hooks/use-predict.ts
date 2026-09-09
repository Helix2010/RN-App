import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { Page } from "../../../core/gateways/types";
import { useGateways } from "../../../core/gateways/gateway-context";
import { PREDICT_ACCOUNT_KEY } from "./use-predict-account";
import type { Money } from "../../../core/money/money";
import type {
  CryptoLiveSource,
  CryptoTick,
  EventQuery,
  LeaderboardPeriod,
  OrderBook,
  PlaceOrderRequest,
  PredictEvent,
  PriceRange,
  DisputeStep,
} from "../model/predict";

export function usePredictTags() {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-tags"],
    queryFn: () => predict.listTags(),
    staleTime: 10 * 60_000,
  });
}

export function usePredictEvents(
  query: EventQuery,
  options: { enabled?: boolean } = {},
) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-events", query],
    queryFn: () => predict.listEvents(query),
    // 预测模块关着时不能有任何请求打到平台：首页热门榜等共享入口按开关关掉查询
    enabled: options.enabled ?? true,
    staleTime: 10_000,
  });
}

/**
 * 列表页用：按平台 cursor 一页页往下翻（原来只拿第一页 20 条，用户看不到后面的事件）。
 * 数据按 `pages` 累积，界面 flatMap 后再做本地搜索 / 去重。
 */
export function usePredictEventPages(
  query: Omit<EventQuery, "cursor">,
  options: { enabled?: boolean } = {},
) {
  const { predict } = useGateways();
  return useInfiniteQuery({
    queryKey: ["predict-event-pages", query],
    queryFn: ({ pageParam }) =>
      predict.listEvents({ ...query, cursor: pageParam ?? undefined }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: options.enabled ?? true,
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

/** 首页策展位；调用方按模块开关决定 enabled，关着时不得请求平台 */
export function useCuratedEvents(options: { enabled?: boolean } = {}) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-curated-events"],
    queryFn: () => predict.listCuratedEvents(),
    enabled: options.enabled ?? true,
    staleTime: 60_000,
  });
}

type Gated = { enabled?: boolean };

/** 收藏列表：逐个取事件，收藏的 id 不在当前分页里也能看到；单个失败不影响其余 */
export function useFavoriteEvents(ids: string[], options: Gated = {}) {
  const { predict } = useGateways();
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: ["predict-event", id],
      queryFn: () => predict.getEvent(id),
      enabled: options.enabled ?? true,
      staleTime: 10_000,
    })),
  });
}

export function useHolders(marketId: string | undefined, options: Gated = {}) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-holders", marketId],
    queryFn: () => predict.getHolders(marketId as string),
    enabled: Boolean(marketId) && (options.enabled ?? true),
    staleTime: 60_000,
  });
}

/**
 * 地区限制：一次进程查一次（网页版一次会话查一次），失败不放行，界面给重试。
 * 只由预测模块内的页面调用；共享入口不发起。
 */
export function useRegionAccess(options: Gated = {}) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-region"],
    queryFn: () => predict.checkRegion(),
    enabled: options.enabled ?? true,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
  });
}

/** 三态：allowed / restricted / unknown（检查失败或还没回来）；blocked = 不是 allowed */
export function useRegionGate(options: Gated = {}) {
  const region = useRegionAccess(options);
  const state: "allowed" | "restricted" | "unknown" = region.isError
    ? "unknown"
    : region.data === undefined
      ? "unknown"
      : region.data.restricted
        ? "restricted"
        : "allowed";
  return {
    state,
    blocked: state !== "allowed",
    failed: region.isError,
    retry: () => void region.refetch(),
  };
}

export function useSeriesList(options: { enabled?: boolean } = {}) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-series"],
    queryFn: () => predict.listSeries(),
    enabled: options.enabled ?? true,
    staleTime: 5 * 60_000,
  });
}

export function useSeries(
  slug: string | undefined,
  id?: string,
  options: Gated = {},
) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-series", slug, id],
    queryFn: () => predict.getSeries(slug as string, id),
    enabled: Boolean(slug) && (options.enabled ?? true),
    staleTime: 5 * 60_000,
  });
}

/** 当期切片每 15 秒刷新一次：窗口只有几分钟，价格与阶段变化快 */
export function useSeriesPeriods(
  seriesId: string | undefined,
  scope: "current" | "closed",
  limit?: number,
  options: Gated = {},
) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-series-periods", seriesId, scope, limit],
    queryFn: () => predict.listSeriesPeriods(seriesId as string, scope, limit),
    enabled: Boolean(seriesId) && (options.enabled ?? true),
    staleTime: scope === "current" ? 5_000 : 60_000,
    refetchInterval: scope === "current" ? 15_000 : false,
  });
}

/** 历史期分页（系列页"更早" / 加载更多）：按平台 nextCursor 往前翻 */
export function useClosedSeriesPeriods(
  seriesId: string | undefined,
  limit = 12,
) {
  const { predict } = useGateways();
  return useInfiniteQuery({
    queryKey: ["predict-series-periods", seriesId, "closed-pages", limit],
    queryFn: ({ pageParam }) =>
      predict.listSeriesPeriods(seriesId as string, "closed", limit, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: Boolean(seriesId),
    staleTime: 60_000,
  });
}

/** 某个市场（周期市场的一期）上我的仓位：含已结算 / 已领取的，系列页仓位条用 */
export function useSeriesPositions(
  address: string | undefined,
  marketId: string | null | undefined,
) {
  const positions = usePositions(address, true);
  const items = useMemo(
    () =>
      marketId
        ? (positions.data ?? []).filter((item) => item.marketId === marketId)
        : [],
    [marketId, positions.data],
  );
  return { ...positions, items };
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
        // WS 簿事件不带 min_order_size，网关只能按 gamma 兜底；REST 拉到过的值更准，保留；
        // 成交价同理：这帧没带就沿用上一次的
        queryClient.setQueryData<OrderBook>(
          ["predict-book", event.book.marketId],
          (old) => ({
            ...event.book,
            minOrderShares: old?.minOrderShares ?? event.book.minOrderShares,
            lastTradeCents:
              event.book.lastTradeCents ?? old?.lastTradeCents ?? null,
          }),
        );
        return;
      }
      if (event.type === "last_trade") {
        queryClient.setQueryData<OrderBook>(
          ["predict-book", event.marketId],
          (old) => (old ? { ...old, lastTradeCents: event.priceCents } : old),
        );
        void queryClient.invalidateQueries({
          queryKey: ["predict-trades", event.marketId],
        });
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

/** 最近成交（成交 Tab）；有推送时按 last_trade 事件失效重取，否则 15 秒一轮 */
export function useTrades(marketId: string | undefined, limit = 50) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-trades", marketId, limit],
    queryFn: () => predict.listTrades(marketId as string, limit),
    enabled: Boolean(marketId),
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
}

/** 一个或多个市场的走势（多结果事件画多条线），键 `["predict-history", marketId, range]` */
export function usePriceHistories(marketIds: string[], range: PriceRange) {
  const { predict } = useGateways();
  return useQueries({
    queries: marketIds.map((marketId) => ({
      queryKey: ["predict-history", marketId, range],
      queryFn: () => predict.getPriceHistory(marketId, range),
      staleTime: 30_000,
    })),
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

/** 争议条款（链上押金 / 到期 / 本地址余额）：面板打开时才读，15 秒刷新一次 */
export function useDisputeTerms(
  address: string | undefined,
  marketId: string | undefined,
  enabled: boolean,
) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-dispute-terms", address, marketId],
    queryFn: () =>
      predict.getDisputeTerms(address as string, marketId as string),
    enabled: Boolean(address && marketId && enabled),
    refetchInterval: 15_000,
  });
}

export function useSubmitDispute(address: string | undefined) {
  const { predict } = useGateways();
  const invalidate = useInvalidateAccount();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      marketId: string;
      evidence: string;
      links: string[];
      onStep?: (step: DisputeStep) => void;
    }) =>
      predict.submitDispute(
        address as string,
        input.marketId,
        { evidence: input.evidence, links: input.links },
        input.onStep,
      ),
    onSuccess: (_result, input) => {
      if (address) invalidate(address);
      void queryClient.invalidateQueries({
        queryKey: ["predict-adjudication", input.marketId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["predict-dispute-terms"],
      });
    },
  });
}

/** 押金不够：把钱包 USDC 兑换成 USDW 到本地址；成功后条款与钱包余额都要重读 */
export function useWrapForDispute(address: string | undefined) {
  const { predict } = useGateways();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      amount: Money;
      onStep?: (step: "approve" | "wrap") => void;
    }) => predict.wrapForDispute(address as string, input.amount, input.onStep),
    onSuccess: () => {
      for (const key of [
        ["predict-dispute-terms"],
        ["wallet-balances"],
        ["assets"],
      ])
        void queryClient.invalidateQueries({ queryKey: key });
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

// ---- 实时数据服务（周期市场标的价）；只由系列页调用 ----

export function useCryptoLiveSource(
  input: {
    symbol: string | null;
    recurrence?: string;
    resolutionSource?: string | null;
  },
  options: Gated = {},
) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: [
      "predict-crypto-source",
      input.symbol,
      input.recurrence,
      input.resolutionSource,
    ],
    queryFn: () =>
      predict.getCryptoLiveSource({
        symbol: input.symbol as string,
        recurrence: input.recurrence,
        resolutionSource: input.resolutionSource,
      }),
    enabled: Boolean(input.symbol) && (options.enabled ?? true),
    staleTime: 5 * 60_000,
  });
}

export function useCryptoPriceHistory(
  source: CryptoLiveSource | undefined,
  limit: number,
) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-crypto-history", source?.symbol, source?.source, limit],
    queryFn: () =>
      predict.getCryptoPriceHistory(
        (source as CryptoLiveSource).symbol,
        (source as CryptoLiveSource).source,
        limit,
      ),
    enabled: Boolean(source),
    staleTime: 5_000,
  });
}

/** 1 分钟 K 线，20 秒重拉；source 固定 binance（dev 上唯一有 K 线的源，网页版默认同此） */
/** 1 分钟 K 线；endTime（毫秒）= 看某个历史期时只要它结束前的，那时不再定时刷新 */
export function useCryptoCandles(
  symbol: string | null,
  limit = 30,
  endTime?: number,
) {
  const { predict } = useGateways();
  return useQuery({
    queryKey: ["predict-crypto-candles", symbol, limit, endTime ?? null],
    queryFn: () =>
      predict.getCryptoCandles(
        symbol as string,
        "1m",
        limit,
        "binance",
        endTime,
      ),
    enabled: Boolean(symbol),
    staleTime: endTime === undefined ? 10_000 : Infinity,
    refetchInterval: endTime === undefined ? 20_000 : false,
  });
}

/** 实时价：首屏取最新价，再订阅 WS；返回的 ticks 按时间升序累积（最多 maxTicks 条） */
export function useCryptoLivePrice(
  source: CryptoLiveSource | undefined,
  maxTicks = 1200,
) {
  const { predict } = useGateways();
  const key = source ? `${source.symbol}|${source.source}|${source.topic}` : "";
  // 状态带上取价源的键：换源后旧 tick 不再显示，且不需要在 effect 里同步清空
  const [feed, setFeed] = useState<{
    key: string;
    latest: CryptoTick | null;
    ticks: CryptoTick[];
  }>({ key: "", latest: null, ticks: [] });
  useEffect(() => {
    if (!source) return;
    let active = true;
    const accept = (tick: CryptoTick) => {
      if (!active || !Number.isFinite(tick.value)) return;
      setFeed((old) => {
        const ticks = old.key === key ? old.ticks : [];
        const last = ticks[ticks.length - 1];
        const next = last && last.t >= tick.t ? ticks : [...ticks, tick];
        return {
          key,
          latest: tick,
          ticks:
            next.length > maxTicks ? next.slice(next.length - maxTicks) : next,
        };
      });
    };
    void predict
      .getCryptoLatest(source.symbol, source.source)
      .then(accept, () => {});
    const stop = predict.subscribeCryptoPrice(source, accept);
    return () => {
      active = false;
      stop();
    };
  }, [key, maxTicks, predict, source]);
  return feed.key === key && key !== ""
    ? { latest: feed.latest, ticks: feed.ticks }
    : { latest: null, ticks: [] as CryptoTick[] };
}
