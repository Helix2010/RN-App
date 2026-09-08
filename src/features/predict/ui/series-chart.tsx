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
  InlineText,
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
import { priceLabel, useTicking } from "./series-card";

type ChartMode = "price" | "probability" | "candles";
/** 价格图回填的 tick 数（网页版 HISTORY_TICK_LIMIT） */
const HISTORY_TICKS = 360;
const CANDLE_LIMIT = 30;

/**
 * 周期市场走势图（网页版 `app/predict/crypto/[seriesSlug]` 的三种图）：
 * 价格 = 标的实时价（RTDS 历史回填 + WS 追加，只画当期窗口，参考价做基准线）；
 * 概率 = 当期市场 1 小时 Yes 价；K 线 = 最近 30 根 1 分钟蜡烛（binance）。
 * 标的认不出来只提示，不猜成 BTC。
 */
export function SeriesChart({
  series,
  period,
}: {
  series: Series;
  period: SeriesPeriod | null;
}) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const theme = useTheme();
  const [mode, setMode] = useState<ChartMode>("price");
  // 标的：ticker 优先，其次 slug 与各语言标题里的资产名
  const symbol = useMemo(
    () =>
      resolveCryptoSymbol({
        ticker: series.ticker,
        slug: series.slug,
        title: Object.values(series.title).filter(Boolean).join(" "),
      }),
    [series],
  );
  const liveSource = useCryptoLiveSource({
    symbol,
    recurrence: series.recurrence || undefined,
    resolutionSource: period?.resolutionSource ?? null,
  });
  const history = useCryptoPriceHistory(liveSource.data, HISTORY_TICKS);
  const live = useCryptoLivePrice(liveSource.data);
  const candles = useCryptoCandles(
    mode === "candles" ? symbol : null,
    CANDLE_LIMIT,
  );
  const marketId = period?.event?.markets[0]?.id;
  const probability = usePriceHistories(
    mode === "probability" && marketId ? [marketId] : [],
    "1h",
  )[0];
  const now = useTicking();

  const target = period?.priceToBeat ? Number(period.priceToBeat.price) : null;
  const stale = !live.latest || now - live.latest.t > PRICE_STALE_AFTER_MS;
  const current = stale ? null : live.latest!.value;
  const windowStart = period ? new Date(period.windowStart).getTime() : null;
  const windowEnd = period ? new Date(period.windowEnd).getTime() : null;
  // 价格线：历史 + 实时按时间合并去重，只留当期窗口内的点（没有当期时画全部历史）
  const pricePoints = useMemo(() => {
    const merged = new Map<number, number>();
    for (const tick of history.data ?? []) merged.set(tick.t, tick.value);
    for (const tick of live.ticks) merged.set(tick.t, tick.value);
    return [...merged.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(
        ([tMs]) =>
          windowStart === null ||
          windowEnd === null ||
          (tMs >= windowStart && tMs <= windowEnd),
      )
      .map(([tMs, v]) => ({ t: tMs, v }));
  }, [history.data, live.ticks, windowEnd, windowStart]);

  const formatTime = (tMs: number) =>
    new Date(tMs).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

  if (symbol === null)
    return (
      <Body testID="series-chart-unknown">
        {t("predict.series.symbolUnknown")}
      </Body>
    );

  return (
    <Stack gap="$2" testID="series-chart">
      <Row alignItems="flex-end" justifyContent="space-between" gap="$2">
        <Stack>
          <Body fontSize={11}>{t("predict.series.livePrice")}</Body>
          <InlineText fontSize={22} fontWeight="900" testID="series-live-price">
            {current === null ? "—" : formatUsd(current, locale)}
          </InlineText>
          {current !== null && target !== null && Number.isFinite(target) ? (
            <Body
              fontSize={11}
              color={current >= target ? "$success" : "$danger"}
              testID="series-live-delta"
            >
              {t("predict.series.vsTarget")}{" "}
              {formatUsd(current - target, locale, { sign: true })}
            </Body>
          ) : live.latest && stale ? (
            <Body fontSize={11} color="$textMuted">
              {t("predict.series.priceStale")}
            </Body>
          ) : null}
        </Stack>
        <Stack width={210}>
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
          />
        </Stack>
      </Row>

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
        ) : (
          <PriceLineChart
            height={180}
            series={[
              {
                key: "price",
                label: symbol,
                color: theme.primary.val,
                points: pricePoints,
              },
            ]}
            baseline={
              target !== null && Number.isFinite(target) ? target : undefined
            }
            formatValue={(value) => formatUsd(value, locale)}
            formatTime={formatTime}
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
            formatTime={formatTime}
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
      {period ? (
        <Body fontSize={11}>
          {t("predict.series.priceToBeat")}{" "}
          {priceLabel(period.priceToBeat, locale)}
        </Body>
      ) : null}
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
