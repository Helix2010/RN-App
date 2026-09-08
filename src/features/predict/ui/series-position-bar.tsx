import { useFoundationRuntime } from "../../../app/runtime-context";
import { formatCents, formatMoney, formatUsd } from "../../../core/i18n/format";
import { toApproxNumber } from "../../../core/money/money";
import {
  Body,
  Card,
  InlineText,
  PrimaryButton,
  Row,
  SectionTitle,
  toast,
} from "../../../design-system";
import { useRedeem, useSeriesPositions } from "../hooks/use-predict";
import type { Position, SeriesPeriod } from "../model/predict";
import { fill } from "./shared";

/**
 * 我的仓位条（设计 §4.4）：所选期上我的仓位，随状态变形——
 * 进行中 / 未开始给份数、均价、现值；结算中给"等待结算"；已结算赢给可领取金额 + 领取；输给归零。
 * 只对已登录且在该期有仓位的用户渲染。
 */
export function SeriesPositionBar({
  period,
  address,
}: {
  period: SeriesPeriod;
  address: string;
}) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const positions = useSeriesPositions(address, period.marketId);
  const redeem = useRedeem(address);
  if (positions.items.length === 0) return null;
  const claim = (position: Position) =>
    redeem.mutate([position.id], {
      onSuccess: () =>
        toast(
          fill(t("predict.positions.claimed"), {
            amount: formatMoney(position.value, locale),
          }),
          "success",
        ),
      onError: (error) => toast(error.message || t("state.error"), "error"),
    });
  return (
    <Card padding="$3" gap="$2" testID="series-position-bar">
      <SectionTitle fontSize={13}>
        {t("predict.series.myPosition")}
      </SectionTitle>
      {positions.items.map((position) => (
        <PositionLine
          key={position.id}
          position={position}
          locale={locale}
          claiming={redeem.isPending}
          onClaim={() => claim(position)}
        />
      ))}
    </Card>
  );
}

function PositionLine({
  position,
  locale,
  claiming,
  onClaim,
}: {
  position: Position;
  locale: string;
  claiming: boolean;
  onClaim: () => void;
}) {
  const { t } = useFoundationRuntime();
  const outcome = t(
    position.outcome === "yes" ? "predict.series.up" : "predict.series.down",
  );
  if (position.status === "settled" || position.closed) {
    if (position.redeemable)
      return (
        <Row alignItems="center" justifyContent="space-between" gap="$2">
          <InlineText fontWeight="800" color="$success" flex={1}>
            {fill(t("predict.series.positionWon"), {
              amount: formatMoney(position.value, locale),
            })}
          </InlineText>
          <PrimaryButton
            height={34}
            paddingHorizontal="$3"
            fontSize={13}
            disabled={claiming}
            onPress={onClaim}
            testID={`series-claim-${position.id}`}
          >
            {claiming
              ? t("predict.positions.claiming")
              : t("predict.positions.claim")}
          </PrimaryButton>
        </Row>
      );
    // 赢且已领取（仓位已关闭、结算价 1）；否则就是输
    const won = position.settledPayoutCents === 100;
    return (
      <Body
        fontSize={12}
        color={won ? "$textMuted" : "$danger"}
        testID={`series-position-${won ? "claimed" : "lost"}`}
      >
        {won
          ? `${outcome} · ${t("predict.series.positionClaimed")}`
          : fill(t("predict.series.positionLost"), { shares: position.shares })}
      </Body>
    );
  }
  if (position.status !== "trading")
    return (
      <Body fontSize={12} color="$warning" testID="series-position-waiting">
        {fill(t("predict.series.positionWaiting"), {
          outcome,
          shares: position.shares,
        })}
      </Body>
    );
  const pnl = toApproxNumber(position.pnl);
  return (
    <Row alignItems="center" justifyContent="space-between" gap="$2">
      <Body fontSize={12} flex={1} testID="series-position-live">
        {fill(t("predict.series.positionLive"), {
          outcome,
          shares: position.shares,
          price: formatCents(position.avgPriceCents),
          value: formatMoney(position.value, locale),
        })}
      </Body>
      <InlineText
        fontSize={12}
        fontWeight="700"
        color={pnl >= 0 ? "$pricePositive" : "$priceNegative"}
      >
        {formatUsd(pnl, locale, { sign: true })}
      </InlineText>
    </Row>
  );
}
