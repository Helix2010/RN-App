import { useEffect, useMemo, useRef } from "react";
import { ScrollView } from "react-native";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { formatDate } from "../../../core/i18n/format";
import {
  Body,
  InlineText,
  Row,
  SecondaryButton,
  Sheet,
  type SheetHandle,
  Stack,
} from "../../../design-system";
import type { SeriesPeriod } from "../model/predict";
import {
  clockLabel,
  periodPhase,
  periodResultLabel,
  priceLabel,
  windowLabel,
} from "./series-card";
import { fill } from "./shared";

/** 轨道上历史侧放最近几期、未来侧放当期 + 几期；其余进"更早 / 更多"面板 */
const RAIL_PAST = 3;
const RAIL_UPCOMING = 4;
const CHIP_WIDTH = 72;
const CHIP_GAP = 8;

export type PeriodHistoryControls = {
  hasMore: boolean;
  loading: boolean;
  loadMore: () => void;
  error: boolean;
  retry: () => void;
};

/**
 * 期轨道：更早 ▾ │ 历史 3 期（结果记号）│ 当期 │ 未来 3 期 │ 更多 ▾。
 * 我押过的期带角标；选中的期自动滚到可见位置。
 */
export function SeriesPeriodRail({
  past,
  upcoming,
  currentId,
  selectedId,
  nowMs,
  heldMarketIds,
  onSelect,
  history,
}: {
  /** 历史期，最新在前 */
  past: SeriesPeriod[];
  /** 当期 + 未来期，按开始时间升序 */
  upcoming: SeriesPeriod[];
  currentId: string | null;
  selectedId: string | null;
  nowMs: number;
  heldMarketIds: ReadonlySet<string>;
  onSelect: (period: SeriesPeriod) => void;
  history: PeriodHistoryControls;
}) {
  const { t } = useFoundationRuntime();
  const earlier = useRef<SheetHandle>(null);
  const more = useRef<SheetHandle>(null);
  const scroll = useRef<ScrollView>(null);
  const chips = useMemo(
    () => [
      ...past.slice(0, RAIL_PAST).reverse(),
      ...upcoming.slice(0, RAIL_UPCOMING),
    ],
    [past, upcoming],
  );
  const restUpcoming = upcoming.slice(RAIL_UPCOMING);
  const selectedIndex = chips.findIndex((period) => period.id === selectedId);
  useEffect(() => {
    if (selectedIndex < 0) return;
    // "更早"按钮占一格；把选中的芯片滚到靠左第二格的位置
    scroll.current?.scrollTo({
      x: Math.max(0, selectedIndex * (CHIP_WIDTH + CHIP_GAP)),
      animated: true,
    });
  }, [selectedIndex]);

  const select = (period: SeriesPeriod, sheet: SheetHandle | null) => {
    sheet?.dismiss();
    onSelect(period);
  };

  return (
    <Stack gap="$2">
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: CHIP_GAP, alignItems: "center" }}
        testID="series-rail"
      >
        <RailAction
          label={t("predict.series.earlier")}
          onPress={() => earlier.current?.present()}
          testID="series-rail-earlier"
        />
        {chips.map((period) => (
          <PeriodChip
            key={period.id}
            period={period}
            nowMs={nowMs}
            selected={period.id === selectedId}
            isCurrent={period.id === currentId}
            held={
              period.marketId !== null && heldMarketIds.has(period.marketId)
            }
            onPress={() => onSelect(period)}
          />
        ))}
        {restUpcoming.length > 0 ? (
          <RailAction
            label={t("predict.series.more")}
            onPress={() => more.current?.present()}
            testID="series-rail-more"
          />
        ) : null}
      </ScrollView>

      <Sheet
        ref={earlier}
        title={t("predict.series.past")}
        closeLabel={t("common.close")}
        scroll
        testID="series-earlier-sheet"
      >
        <Stack gap="$1">
          {past.map((period) => (
            <PeriodRow
              key={period.id}
              period={period}
              selected={period.id === selectedId}
              onPress={() => select(period, earlier.current)}
              testIDPrefix="series-earlier"
            />
          ))}
          {history.error ? (
            <Row alignItems="center" justifyContent="space-between" gap="$2">
              <Body color="$danger">{t("state.error")}</Body>
              <SecondaryButton height={32} onPress={history.retry}>
                {t("action.retryNow")}
              </SecondaryButton>
            </Row>
          ) : history.hasMore ? (
            <SecondaryButton
              disabled={history.loading}
              onPress={history.loadMore}
              testID="series-load-earlier"
            >
              {t("predict.series.loadEarlier")}
            </SecondaryButton>
          ) : null}
        </Stack>
      </Sheet>

      <Sheet
        ref={more}
        title={t("predict.series.upcomingList")}
        closeLabel={t("common.close")}
        scroll
        testID="series-more-sheet"
      >
        <Stack gap="$1">
          {upcoming.map((period) => (
            <PeriodRow
              key={period.id}
              period={period}
              selected={period.id === selectedId}
              onPress={() => select(period, more.current)}
              phase={periodPhase(period, nowMs)}
              testIDPrefix="series-more"
            />
          ))}
        </Stack>
      </Sheet>
    </Stack>
  );
}

function RailAction({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Stack
      height={44}
      paddingHorizontal="$3"
      borderRadius="$3"
      justifyContent="center"
      backgroundColor="$surfaceVariant"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      pressStyle={{ opacity: 0.75 }}
      testID={testID}
    >
      <InlineText fontSize={12} fontWeight="700">
        {label} ▾
      </InlineText>
    </Stack>
  );
}

function PeriodChip({
  period,
  nowMs,
  selected,
  isCurrent,
  held,
  onPress,
}: {
  period: SeriesPeriod;
  nowMs: number;
  selected: boolean;
  isCurrent: boolean;
  held: boolean;
  onPress: () => void;
}) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const phase = periodPhase(period, nowMs);
  const phaseLabel =
    phase === "ended"
      ? periodResultLabel(period, t)
      : t(`predict.series.${phase}`);
  const marker =
    phase === "ended" ? (
      <InlineText
        fontSize={11}
        fontWeight="900"
        color={
          period.result === "up"
            ? "$success"
            : period.result === "down"
              ? "$danger"
              : "$textMuted"
        }
      >
        {period.result === "up" ? "▲" : period.result === "down" ? "▼" : "•"}
      </InlineText>
    ) : (
      <Stack
        width={8}
        height={8}
        borderRadius={4}
        backgroundColor={phase === "live" ? "$success" : "transparent"}
        borderWidth={phase === "live" ? 0 : 1}
        borderColor={selected ? "$background" : "$textMuted"}
      />
    );
  return (
    <Stack
      width={CHIP_WIDTH}
      height={44}
      borderRadius="$3"
      alignItems="center"
      justifyContent="center"
      gap={2}
      backgroundColor={selected ? "$color" : "$surfaceVariant"}
      borderWidth={isCurrent && !selected ? 1 : 0}
      borderColor="$success"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={fill(t("predict.series.periodLabel"), {
        window: windowLabel(period, locale),
        phase: phaseLabel,
      })}
      pressStyle={{ opacity: 0.75 }}
      testID={`series-chip-${period.id}`}
    >
      <InlineText
        fontSize={12}
        fontWeight="800"
        color={selected ? "$background" : "$color"}
      >
        {clockLabel(period.windowStart, locale)}
      </InlineText>
      {marker}
      {held ? (
        <Stack
          position="absolute"
          top={4}
          right={4}
          width={7}
          height={7}
          borderRadius={4}
          backgroundColor="$warning"
          accessibilityLabel={t("predict.series.hasPosition")}
          testID={`series-chip-held-${period.id}`}
        />
      ) : null}
    </Stack>
  );
}

/** 一期一行：窗口、日期、参考价 → 结算价、结果；面板与历史列表共用 */
export function PeriodRow({
  period,
  onPress,
  selected = false,
  phase,
  testIDPrefix = "series-period",
}: {
  period: SeriesPeriod;
  onPress: () => void;
  selected?: boolean;
  /** 未来面板里给"未开始 / 进行中"，历史行不传（按结果显示） */
  phase?: "live" | "upcoming" | "ended";
  /** 历史列表与两个面板各用一个前缀，测试与无障碍都能分清 */
  testIDPrefix?: string;
}) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const ended = phase === undefined || phase === "ended";
  const label = ended
    ? periodResultLabel(period, t)
    : t(`predict.series.${phase}`);
  return (
    <Row
      alignItems="center"
      gap="$3"
      paddingVertical="$2"
      paddingHorizontal="$1"
      borderRadius="$2"
      backgroundColor={selected ? "$surfaceVariant" : "transparent"}
      borderBottomWidth={1}
      borderColor="$borderColor"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      testID={`${testIDPrefix}-${period.id}`}
    >
      <Stack flex={1} gap="$0.5">
        <InlineText fontSize={13} fontWeight="700">
          {windowLabel(period, locale)}
        </InlineText>
        <Body fontSize={11}>
          {formatDate(period.windowEnd, locale)} ·{" "}
          {t("predict.series.priceToBeat")}{" "}
          {period.priceToBeat
            ? priceLabel(period.priceToBeat, locale)
            : t("predict.series.priceAtOpen")}
          {ended
            ? ` · ${t("predict.series.finalPrice")} ${priceLabel(period.finalPrice, locale)}`
            : ""}
        </Body>
      </Stack>
      <InlineText
        fontWeight="800"
        color={
          period.result === "up"
            ? "$success"
            : period.result === "down"
              ? "$danger"
              : "$textMuted"
        }
      >
        {label}
      </InlineText>
    </Row>
  );
}
