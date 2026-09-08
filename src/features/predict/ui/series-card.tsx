import { useEffect, useState } from "react";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { formatCountdown, formatPercentCents } from "../../../core/i18n/format";
import { pickTranslation } from "../../../core/i18n/localized-text";
import { mockNow } from "../../../core/mock/mock-runtime";
import {
  Body,
  Card,
  InlineText,
  Row,
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

export function windowLabel(period: SeriesPeriod, locale: string): string {
  const format = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  return `${format(period.windowStart)} – ${format(period.windowEnd)}`;
}

/** 每秒刷新的"现在"，倒计时用；秒级刷新只在卡片内部，不牵动列表 */
export function useTicking(): number {
  const [now, setNow] = useState(mockNow());
  useEffect(() => {
    const timer = setInterval(() => setNow(mockNow()), 1_000);
    return () => clearInterval(timer);
  }, []);
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
  const live = period ? isPeriodLive(period, now) : false;
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
      {periods.data === undefined ? (
        <SkeletonBlock height={44} />
      ) : period ? (
        <>
          <Row alignItems="center" gap="$2">
            <InlineText
              fontSize={11}
              fontWeight="800"
              color={live ? "$success" : "$textMuted"}
            >
              {t(live ? "predict.series.live" : "predict.series.upcoming")}
            </InlineText>
            <Body fontSize={11}>{windowLabel(period, locale)}</Body>
            <Body fontSize={11}>
              {live
                ? fill(t("predict.series.endsIn"), {
                    time: formatCountdown(period.windowEnd, now),
                  })
                : fill(t("predict.series.startsIn"), {
                    time: formatCountdown(period.windowStart, now),
                  })}
            </Body>
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
