import { useFoundationRuntime } from "../../../app/runtime-context";
import { formatCents, formatUsd } from "../../../core/i18n/format";
import {
  Body,
  Card,
  DetailRow,
  InlineText,
  Row,
  SecondaryButton,
  Stack,
} from "../../../design-system";
import type { useRegionGate } from "../hooks/use-predict";
import type { Market, Outcome, SeriesPeriod } from "../model/predict";
import {
  clockLabel,
  periodCountdown,
  periodResultLabel,
  priceLabel,
  windowLabel,
} from "./series-card";
import type { SeriesLivePrice } from "./series-chart";
import { fill, RegionNotice } from "./shared";

/** 最后 30 秒倒计时变警示色并标"即将结束" */
const ENDING_SOON_MS = 30_000;

export type PeriodPhase = "live" | "upcoming" | "ended";

/** 已结束的期：有结果或阶段失败 / 暂缓 = 已结算，否则还在结算中 */
export function isPeriodSettled(period: SeriesPeriod): boolean {
  return (
    period.result !== null ||
    period.stage === "failed" ||
    period.stage === "held"
  );
}

/**
 * 所选期卡（设计 §4.3 的四种形态）：进行中 / 未开始 / 结算中 / 已结算。
 * 头部 = 状态徽章 + 窗口 + 倒计时；价格区 = 参考价、当前价（进行中）或结算价（已结束）；
 * 动作区 = 涨 / 跌 两个下单按钮（未结束期）+ 查看详情 / 回到当期。
 */
export function SeriesPeriodCard({
  period,
  phase,
  nowMs,
  isCurrent,
  live,
  region,
  onOrder,
  onBackToCurrent,
  onOpenDetail,
  showGoNext,
  onGoNext,
}: {
  period: SeriesPeriod;
  phase: PeriodPhase;
  nowMs: number;
  isCurrent: boolean;
  live: SeriesLivePrice;
  region: ReturnType<typeof useRegionGate>;
  onOrder: (market: Market, outcome: Outcome) => void;
  onBackToCurrent: () => void;
  onOpenDetail: () => void;
  /** 停在有仓位的已结束期时，提示下一期已经开始 */
  showGoNext: boolean;
  onGoNext: () => void;
}) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const market = period.event?.markets[0];
  const settled = phase === "ended" && isPeriodSettled(period);
  const settling = phase === "ended" && !settled;
  const remainingMs = new Date(period.windowEnd).getTime() - nowMs;
  const endingSoon = phase === "live" && remainingMs <= ENDING_SOON_MS;
  const badge = settled
    ? periodResultLabel(period, t)
    : settling
      ? t("predict.series.settling")
      : t(`predict.series.${phase}`);
  const badgeColor =
    phase === "live"
      ? "$success"
      : phase === "upcoming"
        ? "$textMuted"
        : settling
          ? "$warning"
          : period.result === "up"
            ? "$success"
            : period.result === "down"
              ? "$danger"
              : "$textMuted";
  const yes = market?.yesPriceCents ?? null;
  const canTrade = phase !== "ended" && market !== undefined;
  const accepting = market?.acceptingOrders ?? false;
  const disabled = !canTrade || !accepting || region.blocked;

  return (
    <Card padding="$3" gap="$2" testID="series-period-card">
      <Row alignItems="center" justifyContent="space-between" gap="$2">
        <Row alignItems="center" gap="$2" flex={1}>
          <InlineText
            fontSize={11}
            fontWeight="800"
            color={badgeColor}
            testID="series-period-phase"
          >
            {badge}
          </InlineText>
          <Body fontSize={12} testID="series-period-window">
            {windowLabel(period, locale)}
          </Body>
        </Row>
        {!isCurrent ? (
          <SecondaryButton
            height={28}
            paddingHorizontal="$2.5"
            fontSize={12}
            onPress={onBackToCurrent}
            testID="series-back-current"
          >
            {t("predict.series.backToCurrent")}
          </SecondaryButton>
        ) : null}
      </Row>

      {phase === "live" ? (
        <Row alignItems="baseline" gap="$2">
          <InlineText
            fontSize={22}
            fontWeight="900"
            color={endingSoon ? "$warning" : "$color"}
            testID="series-countdown"
          >
            {periodCountdown(period, nowMs, t)}
          </InlineText>
          {endingSoon ? (
            <InlineText fontSize={11} fontWeight="800" color="$warning">
              {t("predict.series.endingSoon")}
            </InlineText>
          ) : null}
        </Row>
      ) : phase === "upcoming" ? (
        <Stack>
          <InlineText fontSize={22} fontWeight="900" testID="series-countdown">
            {periodCountdown(period, nowMs, t)}
          </InlineText>
          <Body fontSize={12}>
            {fill(t("predict.series.opensAt"), {
              time: clockLabel(period.windowStart, locale),
            })}
          </Body>
        </Stack>
      ) : settling ? (
        <Body fontSize={12} color="$warning" testID="series-countdown">
          {t("predict.series.awaitingFinal")}
        </Body>
      ) : null}

      <DetailRow
        label={t("predict.series.priceToBeat")}
        value={
          period.priceToBeat
            ? priceLabel(period.priceToBeat, locale)
            : phase === "upcoming"
              ? t("predict.series.priceAtOpen")
              : priceLabel(null, locale)
        }
      />
      {phase === "upcoming" && !period.priceToBeat ? (
        <Body fontSize={11}>{t("predict.series.priceAtOpenHint")}</Body>
      ) : null}

      {phase === "live" && live.symbol !== null ? (
        <Row alignItems="flex-end" justifyContent="space-between" gap="$2">
          <Stack>
            <Body fontSize={11}>{t("predict.series.livePrice")}</Body>
            <InlineText
              fontSize={20}
              fontWeight="900"
              testID="series-live-price"
            >
              {live.current === null ? "—" : formatUsd(live.current, locale)}
            </InlineText>
          </Stack>
          {live.current !== null && live.target !== null ? (
            <Body
              fontSize={12}
              fontWeight="700"
              color={live.current >= live.target ? "$success" : "$danger"}
              testID="series-live-delta"
            >
              {t("predict.series.vsTarget")}{" "}
              {formatUsd(live.current - live.target, locale, { sign: true })}
            </Body>
          ) : live.stale && live.live.latest ? (
            <Body fontSize={11} color="$textMuted">
              {t("predict.series.priceStale")}
            </Body>
          ) : null}
        </Row>
      ) : null}

      {phase === "ended" ? (
        <>
          <DetailRow
            label={t("predict.series.finalPrice")}
            value={
              period.finalPrice
                ? priceLabel(period.finalPrice, locale)
                : t("predict.series.finalPending")
            }
          />
          {period.finalPrice?.source ? (
            <DetailRow
              label={t("predict.series.source")}
              value={period.finalPrice.source}
            />
          ) : null}
        </>
      ) : null}

      {canTrade && market ? (
        <Stack gap="$2">
          {phase === "upcoming" && accepting ? (
            <Body fontSize={11} fontWeight="700">
              {t("predict.series.preOrder")}
            </Body>
          ) : null}
          <Row gap="$2" opacity={disabled ? 0.45 : 1}>
            <OrderButton
              outcome="yes"
              label={t("predict.series.up")}
              priceCents={yes}
              disabled={disabled}
              onPress={() => onOrder(market, "yes")}
            />
            <OrderButton
              outcome="no"
              label={t("predict.series.down")}
              priceCents={yes === null ? null : 100 - yes}
              disabled={disabled}
              onPress={() => onOrder(market, "no")}
            />
          </Row>
          {!accepting ? (
            <Body
              fontSize={11}
              color="$textMuted"
              testID="series-not-accepting"
            >
              {t("predict.series.notAcceptingYet")}
            </Body>
          ) : yes === null ? (
            <Body fontSize={11} color="$textMuted" testID="series-no-quote">
              {t("predict.series.noQuoteHint")}
            </Body>
          ) : null}
          <RegionNotice state={region.state} onRetry={region.retry} />
        </Stack>
      ) : null}

      <Row gap="$2" alignItems="center">
        {period.event ? (
          <SecondaryButton
            height={32}
            paddingHorizontal="$3"
            fontSize={12}
            onPress={onOpenDetail}
            testID="series-open-detail"
          >
            {t("predict.series.viewDetail")}
          </SecondaryButton>
        ) : null}
        {showGoNext ? (
          <SecondaryButton
            height={32}
            paddingHorizontal="$3"
            fontSize={12}
            onPress={onGoNext}
            testID="series-go-next"
          >
            {t("predict.series.nextStarted")}
          </SecondaryButton>
        ) : null}
      </Row>
    </Card>
  );
}

function OrderButton({
  outcome,
  label,
  priceCents,
  disabled,
  onPress,
}: {
  outcome: Outcome;
  label: string;
  priceCents: number | null;
  disabled: boolean;
  onPress: () => void;
}) {
  const { t } = useFoundationRuntime();
  const price =
    priceCents === null ? t("predict.series.noQuote") : formatCents(priceCents);
  return (
    <Stack
      flex={1}
      height={48}
      borderRadius="$3"
      alignItems="center"
      justifyContent="center"
      backgroundColor="$surfaceVariant"
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={`${label} ${price}`}
      pressStyle={{ opacity: 0.75 }}
      testID={`series-order-${outcome === "yes" ? "up" : "down"}`}
    >
      <InlineText
        color={outcome === "yes" ? "$success" : "$danger"}
        fontWeight="900"
        fontSize={15}
      >
        {label} · {price}
      </InlineText>
    </Stack>
  );
}
