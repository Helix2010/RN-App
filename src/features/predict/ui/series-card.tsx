import { useEffect, useState } from "react";
import { useFoundationRuntime } from "../../../app/runtime-context";
import {
  formatCountdown,
  formatPercentCents,
  formatUsd,
  NO_QUOTE,
} from "../../../core/i18n/format";
import { pickTranslation } from "../../../core/i18n/localized-text";
import { mockNow } from "../../../core/mock/mock-runtime";
import {
  Body,
  Card,
  InlineText,
  Row,
  SecondaryButton,
  SectionTitle,
  SkeletonBlock,
  Stack,
} from "../../../design-system";
import { useSeriesPeriods } from "../hooks/use-predict";
import type { Market, Outcome, Series, SeriesPeriod } from "../model/predict";
import { fill, YesNoButtons } from "./shared";

/** 选出"当期"：包含 now 的窗口优先，否则最近的未来期，否则最新一期（与网页版 pickCurrentPeriod 一致） */
export function pickCurrentPeriod(
  periods: SeriesPeriod[],
  nowMs: number,
): SeriesPeriod | null {
  if (periods.length === 0) return null;
  const asc = [...periods].sort(
    (a, b) =>
      new Date(a.windowStart).getTime() - new Date(b.windowStart).getTime(),
  );
  const live = asc.find(
    (period) =>
      new Date(period.windowStart).getTime() <= nowMs &&
      nowMs < new Date(period.windowEnd).getTime(),
  );
  if (live) return live;
  const upcoming = asc.find(
    (period) => new Date(period.windowStart).getTime() > nowMs,
  );
  return upcoming ?? asc[asc.length - 1] ?? null;
}

export function isPeriodLive(period: SeriesPeriod, nowMs: number): boolean {
  return (
    new Date(period.windowStart).getTime() <= nowMs &&
    nowMs < new Date(period.windowEnd).getTime()
  );
}

/** 当期窗口相对现在的状态：进行中 / 未开始 / 已结束（最后一期结束、下一期还没生成时） */
export function periodPhase(
  period: SeriesPeriod,
  nowMs: number,
): "live" | "upcoming" | "ended" {
  if (isPeriodLive(period, nowMs)) return "live";
  return new Date(period.windowStart).getTime() > nowMs ? "upcoming" : "ended";
}

/** 窗口状态一行：进行中给"剩余"，未开始给"后开始"，已结束只给"已结束" */
export function periodCountdown(
  period: SeriesPeriod,
  nowMs: number,
  t: (key: string) => string,
): string {
  const phase = periodPhase(period, nowMs);
  if (phase === "ended") return t("predict.series.ended");
  return fill(
    t(phase === "live" ? "predict.series.endsIn" : "predict.series.startsIn"),
    {
      time: formatCountdown(
        phase === "live" ? period.windowEnd : period.windowStart,
        nowMs,
      ),
    },
  );
}

/** 历史窗口的结果文案：涨 / 跌，没结果时按阶段给失败 / 暂停，否则待结算 */
export function periodResultLabel(
  period: SeriesPeriod,
  t: (key: string) => string,
): string {
  if (period.result === "up") return t("predict.series.up");
  if (period.result === "down") return t("predict.series.down");
  if (period.stage === "failed" || period.stage === "held")
    return t(`predict.series.stage.${period.stage}`);
  return t("predict.series.pending");
}

export function windowLabel(period: SeriesPeriod, locale: string): string {
  const format = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  return `${format(period.windowStart)} – ${format(period.windowEnd)}`;
}

/** 参考价 / 结算价：平台给的是高精度字符串，展示成美元两位小数（网页版 `formatUsd(priceToBeat)`）；不是数字就原样显示 */
export function priceLabel(
  price: { price: string } | null,
  locale: string,
): string {
  if (!price) return NO_QUOTE;
  const value = Number(price.price);
  return Number.isFinite(value) ? formatUsd(value, locale) : price.price;
}

// 所有倒计时共用一个秒表：多少张卡都只有一个 setInterval，最后一个订阅者走了就停
const tickListeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;
export function subscribeTick(listener: () => void): () => void {
  tickListeners.add(listener);
  if (tickTimer === null)
    tickTimer = setInterval(() => {
      for (const notify of tickListeners) notify();
    }, 1_000);
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

/** 每秒刷新的"现在"，倒计时用；秒级刷新只在订阅的卡片内部，不牵动列表 */
export function useTicking(): number {
  const [now, setNow] = useState(mockNow());
  useEffect(() => subscribeTick(() => setNow(mockNow())), []);
  return now;
}

/**
 * 周期市场卡：系列标题 + 当期窗口与倒计时 + 涨 / 跌双钮。
 * 只在当期窗口内且带市场时才能下单；未来期与已结束期只展示。
 */
export function SeriesCard({
  series,
  onOpen,
  onOrder,
}: {
  series: Series;
  onOpen: (series: Series) => void;
  onOrder: (market: Market, outcome: Outcome) => void;
}) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const periods = useSeriesPeriods(series.id, "current", 2);
  const now = useTicking();
  const period = periods.data ? pickCurrentPeriod(periods.data, now) : null;
  const phase = period ? periodPhase(period, now) : "ended";
  const live = phase === "live";
  const market = period?.event?.markets[0];
  return (
    <Card
      padding="$3"
      shadowOpacity={0}
      gap="$2"
      onPress={() => onOpen(series)}
      accessibilityRole="button"
      testID={`series-${series.slug}`}
    >
      <Row alignItems="center" justifyContent="space-between">
        <SectionTitle numberOfLines={1} flex={1}>
          {pickTranslation(series.title, locale)}
        </SectionTitle>
        <InlineText
          fontSize={11}
          fontWeight="800"
          paddingHorizontal="$2"
          paddingVertical="$0.5"
          borderRadius={999}
          backgroundColor="$surfaceVariant"
        >
          {series.recurrence}
        </InlineText>
      </Row>
      {periods.isError ? (
        <Row alignItems="center" justifyContent="space-between" gap="$2">
          <Body fontSize={12} color="$danger">
            {t("predict.series.error")}
          </Body>
          <SecondaryButton height={28} onPress={() => void periods.refetch()}>
            {t("action.retryNow")}
          </SecondaryButton>
        </Row>
      ) : periods.data === undefined ? (
        <SkeletonBlock height={44} />
      ) : period ? (
        <>
          <Row alignItems="center" gap="$2">
            <InlineText
              fontSize={11}
              fontWeight="800"
              color={live ? "$success" : "$textMuted"}
            >
              {t(`predict.series.${phase}`)}
            </InlineText>
            <Body fontSize={11}>{windowLabel(period, locale)}</Body>
            <Body fontSize={11}>{periodCountdown(period, now, t)}</Body>
          </Row>
          {market ? (
            <Row alignItems="center" gap="$2">
              <InlineText fontWeight="800" width={44}>
                {formatPercentCents(market.yesPriceCents)}
              </InlineText>
              <Stack flex={1}>
                <YesNoButtons
                  yes={market.yesPriceCents}
                  compact
                  disabled={!live || !market.acceptingOrders}
                  onPress={(outcome) => onOrder(market, outcome)}
                />
              </Stack>
            </Row>
          ) : null}
        </>
      ) : (
        <Body fontSize={12}>{t("predict.series.noPeriods")}</Body>
      )}
    </Card>
  );
}
