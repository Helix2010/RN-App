import { useMemo, useState } from "react";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { formatUsd } from "../../../core/i18n/format";
import {
  PRICE_STALE_AFTER_MS,
  resolveCryptoSymbol,
} from "../../../core/predict-platform/rtds";
import {
  Body,
  CandleChart,
  PriceLineChart,
  Row,
  SecondaryButton,
  SegmentedControl,
  SkeletonBlock,
  Stack,
  useTheme,
} from "../../../design-system";
import {
  useCryptoCandles,
  useCryptoLivePrice,
  useCryptoLiveSource,
  useCryptoPriceHistory,
  usePriceHistories,
} from "../hooks/use-predict";
import type { Series, SeriesPeriod } from "../model/predict";
import { clockLabel } from "./series-card";

type ChartMode = "price" | "probability" | "candles";
/** 价格图回填的 tick 数（网页版 HISTORY_TICK_LIMIT） */
const HISTORY_TICKS = 360;
const CANDLE_LIMIT = 30;

export type SeriesLivePrice = {
  symbol: string | null;
  liveSource: ReturnType<typeof useCryptoLiveSource>;
  history: ReturnType<typeof useCryptoPriceHistory>;
  live: ReturnType<typeof useCryptoLivePrice>;
  /** 没过期的当前价；过期或还没收到为 null */
  current: number | null;
  stale: boolean;
  /** 所选期参考价（数字）；未来期还没有时为 null */
  target: number | null;
};

/**
 * 标的实时价（RTDS 取价源 + 历史回填 + WS 追加）：系列页只订阅一次，所选期卡显示当前价与较参考价，走势图画线。
 * 标的认不出来时 symbol 为 null，什么都不请求。
 */
export function useSeriesLivePrice(
  series: Series | undefined,
  period: SeriesPeriod | null,
  nowMs: number,
): SeriesLivePrice {
  // 标的：ticker 优先，其次 slug 与各语言标题里的资产名
  const symbol = useMemo(
    () =>
      series
        ? resolveCryptoSymbol({
            ticker: series.ticker,
            slug: series.slug,
            title: Object.values(series.title).filter(Boolean).join(" "),
          })
        : null,
    [series],
  );
  const liveSource = useCryptoLiveSource({
    symbol,
    recurrence: series?.recurrence || undefined,
    resolutionSource: period?.resolutionSource ?? null,
  });
  const history = useCryptoPriceHistory(liveSource.data, HISTORY_TICKS);
  const live = useCryptoLivePrice(liveSource.data);
  const stale = !live.latest || nowMs - live.latest.t > PRICE_STALE_AFTER_MS;
  const current = stale ? null : live.latest!.value;
  const targetRaw = period?.priceToBeat
    ? Number(period.priceToBeat.price)
    : NaN;
  return {
    symbol,
    liveSource,
    history,
    live,
    current,
    stale,
    target: Number.isFinite(targetRaw) ? targetRaw : null,
  };
}

/**
 * 周期市场走势图（网页版 `app/predict/crypto/[seriesSlug]` 的三种图）：
 * 价格 = 标的实时价，只画所选期窗口，参考价做基准线；概率 = 所选期市场 1 小时 Yes 价；
 * K 线 = 30 根 1 分钟蜡烛（binance），看历史期时只取该期结束前的。
 * 当前价与较参考价显示在所选期卡上，这里只画图。
 */
export function SeriesChart({
  series,
  period,
  phase,
  live,
}: {
  series: Series;
  period: SeriesPeriod | null;
  phase: "live" | "upcoming" | "ended";
  live: SeriesLivePrice;
}) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const theme = useTheme();
  const [mode, setMode] = useState<ChartMode>("price");
  const { symbol, liveSource, history } = live;
  const windowStart = period ? new Date(period.windowStart).getTime() : null;
  const windowEnd = period ? new Date(period.windowEnd).getTime() : null;
  const candles = useCryptoCandles(
    mode === "candles" ? symbol : null,
    CANDLE_LIMIT,
    phase === "ended" && windowEnd !== null ? windowEnd : undefined,
  );
  const marketId = period?.event?.markets[0]?.id;
  const probability = usePriceHistories(
    mode === "probability" && marketId ? [marketId] : [],
    "1h",
  )[0];

  // 价格线：历史 + 实时按时间合并去重，只留所选期窗口内的点（没有所选期时画全部历史）
  const pricePoints = useMemo(() => {
    const merged = new Map<number, number>();
    for (const tick of history.data ?? []) merged.set(tick.t, tick.value);
    for (const tick of live.live.ticks) merged.set(tick.t, tick.value);
    return [...merged.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(
        ([tMs]) =>
          windowStart === null ||
          windowEnd === null ||
          (tMs >= windowStart && tMs <= windowEnd),
      )
      .map(([tMs, v]) => ({ t: tMs, v }));
  }, [history.data, live.live.ticks, windowEnd, windowStart]);
  // 历史期的逐笔价格只保留最近 360 个 tick：翻出范围就明说，不画空图
  const historyOutOfRange =
    phase === "ended" && history.data !== undefined && pricePoints.length === 0;

  if (symbol === null)
    return (
      <Body testID="series-chart-unknown">
        {t("predict.series.symbolUnknown")}
      </Body>
    );

  return (
    <Stack gap="$2" testID="series-chart">
      <SegmentedControl
        value={mode}
        options={[
          { value: "price", label: t("predict.series.chart.price") },
          {
            value: "probability",
            label: t("predict.series.chart.probability"),
          },
          { value: "candles", label: t("predict.series.chart.candles") },
        ]}
        onChange={setMode}
        accessibilityLabel={t("predict.series.chart.price")}
        testID="series-chart-mode"
      />

      {mode === "price" ? (
        liveSource.isError || history.isError ? (
          <ChartError
            onRetry={() => {
              void liveSource.refetch();
              void history.refetch();
            }}
          />
        ) : liveSource.data === undefined || history.data === undefined ? (
          <SkeletonBlock height={180} />
        ) : historyOutOfRange ? (
          <Body testID="series-history-unavailable">
            {t("predict.series.historyUnavailable")}
          </Body>
        ) : (
          <PriceLineChart
            height={180}
            axisWidth={78}
            series={[
              {
                key: "price",
                label: symbol,
                color: theme.primary.val,
                points: pricePoints,
              },
            ]}
            baseline={live.target ?? undefined}
            formatValue={(value) => formatUsd(value, locale)}
            formatTime={(tMs) =>
              clockLabel(new Date(tMs).toISOString(), locale)
            }
            empty={<Body>{t("predict.series.chart.empty")}</Body>}
          />
        )
      ) : mode === "probability" ? (
        !probability ? (
          <Body>{t("predict.series.chart.empty")}</Body>
        ) : probability.isError ? (
          <ChartError onRetry={() => void probability.refetch()} />
        ) : probability.data === undefined ? (
          <SkeletonBlock height={180} />
        ) : (
          <PriceLineChart
            height={180}
            series={[
              {
                key: "yes",
                label: "Yes",
                color: theme.success.val,
                points: probability.data.map((point) => ({
                  t: new Date(point.t).getTime(),
                  v: point.priceCents,
                })),
              },
            ]}
            baseline={50}
            formatValue={(value) => `${Math.round(value * 10) / 10}¢`}
            formatTime={(tMs) =>
              clockLabel(new Date(tMs).toISOString(), locale)
            }
            empty={<Body>{t("predict.series.chart.empty")}</Body>}
          />
        )
      ) : candles.isError ? (
        <ChartError onRetry={() => void candles.refetch()} />
      ) : candles.data === undefined ? (
        <SkeletonBlock height={180} />
      ) : candles.data.length === 0 ? (
        <Body>{t("predict.series.chart.empty")}</Body>
      ) : (
        <Stack testID="series-candles">
          <CandleChart height={180} candles={candles.data} />
        </Stack>
      )}
    </Stack>
  );
}

function ChartError({ onRetry }: { onRetry: () => void }) {
  const { t } = useFoundationRuntime();
  return (
    <Row alignItems="center" justifyContent="space-between" gap="$2">
      <Body color="$danger">{t("predict.series.chart.error")}</Body>
      <SecondaryButton
        height={32}
        onPress={onRetry}
        testID="series-chart-retry"
      >
        {t("action.retryNow")}
      </SecondaryButton>
    </Row>
  );
}
