import { useEffect, useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import {
  formatCountdown,
  formatDateTime,
  formatMoney,
  formatUsd,
} from "../../../core/i18n/format";
import { pickTranslation } from "../../../core/i18n/localized-text";
import { mockNow } from "../../../core/mock/mock-runtime";
import {
  AppIcon,
  Body,
  Content,
  DetailRow,
  InlineText,
  Page,
  PageScroll,
  PrimaryButton,
  Row,
  ScreenHeader,
  SecondaryButton,
  SectionTitle,
  type SheetHandle,
  SkeletonBlock,
  Stack,
} from "../../../design-system";
import { useSession } from "../../session/hooks/use-session";
import {
  useAdjudication,
  usePositions,
  usePredictEvent,
} from "../hooks/use-predict";
import { DisputeSheet } from "./dispute-sheet";
import { StatusBadge, fill, outcomeLabel } from "./shared";

const PHASE_KEYS = new Set([
  "trading",
  "awaiting_proposal",
  "proposal_pending",
  "liveness_period",
  "escalation_pending",
  "awaiting_arbitration",
  "arbitration_pending",
  "arbitrated",
  "awaiting_settlement",
  "settlement_pending",
  "settled",
  "cancellation_pending",
  "canceled",
]);

/** 阶段文案：平台 currentPhase 是 snake_case；没收录的阶段原样显示，不猜 */
function phaseLabel(phase: string, t: (key: string) => string): string {
  const key = phase
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return PHASE_KEYS.has(key) ? t(`predict.settlement.phase.${key}`) : phase;
}

/** 结算页骨架：标题两行、结果卡、四步进度、持仓卡、两个按钮，与真实布局同形，数据到了不跳版 */
function SettlementSkeleton() {
  return (
    <Stack gap="$4" testID="settlement-skeleton">
      <Stack gap="$1.5">
        <SkeletonBlock height={22} width={240} />
        <SkeletonBlock height={12} width={200} />
      </Stack>
      <SkeletonBlock height={72} />
      <Stack gap="$0">
        {[0, 1, 2, 3].map((index) => (
          <Row key={index} gap="$3" alignItems="flex-start">
            <Stack alignItems="center" width={24}>
              <SkeletonBlock width={24} height={24} borderRadius={12} />
              {index < 3 ? (
                <Stack
                  width={2}
                  minHeight={28}
                  flex={1}
                  backgroundColor="$borderColor"
                />
              ) : null}
            </Stack>
            <Stack flex={1} paddingBottom="$3" gap="$1.5">
              <SkeletonBlock height={14} width={140} />
              <SkeletonBlock height={12} width={200} />
            </Stack>
          </Row>
        ))}
      </Stack>
      <SkeletonBlock height={110} />
      <Stack gap="$2">
        <SkeletonBlock height={48} />
        <SkeletonBlock height={48} />
      </Stack>
    </Stack>
  );
}

/** P-04 结算进度与争议：四步进度条（倒计时是唯一 warn 色）、你的持仓、提出争议（押金）。 */
export function SettlementScreen({
  marketId,
  eventId,
  onBack,
}: {
  marketId: string;
  /** 市场所属事件（来路知道，不再回查静态夹具） */
  eventId: string;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const session = useSession();
  const address = session.data?.address;
  const event = usePredictEvent(eventId);
  const adjudication = useAdjudication(marketId);
  const positions = usePositions(address, true);
  const disputeSheet = useRef<SheetHandle>(null);
  const [now, setNow] = useState(mockNow());
  const adj = adjudication.data;
  // 平台把取消也放在阶段里（cancellation_pending / canceled）：取消后流程步骤没有意义，只提示已取消
  const canceled = Boolean(adj?.phase && /cancel/i.test(adj.phase));
  const market = event.data?.markets.find((item) => item.id === marketId);
  const mine = positions.data?.find((item) => item.marketId === marketId);

  // 倒计时每秒刷新
  useEffect(() => {
    const timer = setInterval(() => setNow(mockNow()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const steps = adj
    ? [
        {
          key: "closed",
          label: t("predict.settlement.step.closed"),
          detail: formatDateTime(adj.endsAt, locale),
          done: now >= new Date(adj.endsAt).getTime(),
        },
        {
          key: "proposed",
          label: adj.proposedAt
            ? t("predict.settlement.step.proposed")
            : t("predict.settlement.step.awaitingProposal"),
          detail: adj.proposedAt
            ? `${outcomeLabel(adj.proposedOutcome ?? "yes")} · ${formatDateTime(adj.proposedAt, locale)}${adj.proposedEvidence ? ` · ${pickTranslation(adj.proposedEvidence, locale)}` : ""}`
            : "",
          done: Boolean(adj.proposedAt),
        },
        adj.status === "disputed" || adj.status === "arbitrating"
          ? {
              key: "dispute",
              label: t("predict.settlement.step.arbitration"),
              detail: adj.disputedAt
                ? formatDateTime(adj.disputedAt, locale)
                : "",
              done: false,
              warn: true,
            }
          : {
              key: "dispute",
              label: t("predict.settlement.step.dispute"),
              detail:
                adj.disputeDeadline && adj.status === "result_proposed"
                  ? fill(t("predict.settlement.remaining"), {
                      time: formatCountdown(adj.disputeDeadline, now),
                    })
                  : t("predict.settlement.disputeHint"),
              done: adj.status === "settled",
              warn: adj.status === "result_proposed",
            },
        {
          key: "settle",
          label: t("predict.settlement.step.settle"),
          detail:
            adj.status === "settled" && adj.settledOutcome
              ? fill(t("predict.settlement.settledAs"), {
                  outcome: outcomeLabel(adj.settledOutcome),
                })
              : t("predict.settlement.settleHint"),
          done: adj.status === "settled",
        },
      ]
    : [];

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={t("predict.settlement.title")}
          onBack={onBack}
          backLabel={t("action.back")}
          action={adj ? <StatusBadge status={adj.status} /> : undefined}
        />
      </Content>
      <PageScroll>
        <Content paddingTop="$1" gap="$4">
          {event.data && adj ? (
            <>
              <Stack gap="$1">
                <SectionTitle fontSize={18}>
                  {pickTranslation(
                    market?.outcomeLabel ?? event.data.title,
                    locale,
                  )}
                </SectionTitle>
                <Body fontSize={12}>
                  {fill(t("predict.closedAt"), {
                    time: formatDateTime(adj.endsAt, locale),
                  })}{" "}
                  ·{" "}
                  {fill(t("predict.volume"), {
                    amount: formatUsd(event.data.volumeUsd, locale, {
                      compact: true,
                    }),
                  })}
                </Body>
              </Stack>
              {adj.proposedOutcome ? (
                <Row
                  alignItems="center"
                  gap="$3"
                  padding="$3"
                  borderRadius="$4"
                  backgroundColor="$surfaceVariant"
                >
                  <InlineText
                    fontSize={28}
                    fontWeight="900"
                    color={
                      adj.proposedOutcome === "yes" ? "$success" : "$danger"
                    }
                  >
                    {outcomeLabel(adj.proposedOutcome)}
                  </InlineText>
                  <Body>{t("predict.settlement.proposed")}</Body>
                </Row>
              ) : null}
              {canceled ? (
                <Stack
                  padding="$3"
                  borderRadius="$4"
                  backgroundColor="$surfaceVariant"
                  gap="$1"
                  testID="settlement-canceled"
                >
                  <SectionTitle fontSize={14}>
                    {t("predict.settlement.canceled")}
                  </SectionTitle>
                  <Body>{t("predict.settlement.canceledHint")}</Body>
                </Stack>
              ) : null}
              {adj.phase ? (
                <Stack testID="settlement-phase">
                  <DetailRow
                    label={t("predict.settlement.phase")}
                    value={phaseLabel(adj.phase, t)}
                  />
                </Stack>
              ) : null}
              <Stack gap="$0" display={canceled ? "none" : undefined}>
                {steps.map((step, index) => (
                  <Row key={step.key} gap="$3" alignItems="flex-start">
                    <Stack alignItems="center" width={24}>
                      <Stack
                        width={24}
                        height={24}
                        borderRadius={12}
                        backgroundColor={
                          step.done
                            ? "$success"
                            : step.warn
                              ? "$warning"
                              : "$surfaceVariant"
                        }
                        alignItems="center"
                        justifyContent="center"
                        borderWidth={step.done || step.warn ? 0 : 1}
                        borderColor="$borderColor"
                      >
                        {step.done ? (
                          <AppIcon
                            name="check"
                            size={14}
                            colorToken="onPrimary"
                          />
                        ) : (
                          <InlineText
                            fontSize={11}
                            fontWeight="800"
                            color={step.warn ? "$onPrimary" : "$textMuted"}
                          >
                            {index + 1}
                          </InlineText>
                        )}
                      </Stack>
                      {index < steps.length - 1 ? (
                        <Stack
                          width={2}
                          flex={1}
                          minHeight={28}
                          backgroundColor={
                            step.done ? "$success" : "$borderColor"
                          }
                        />
                      ) : null}
                    </Stack>
                    <Stack flex={1} paddingBottom="$3" gap="$0.5">
                      <SectionTitle fontSize={14}>{step.label}</SectionTitle>
                      <Body
                        fontSize={12}
                        color={
                          step.warn && !step.done ? "$warning" : "$textMuted"
                        }
                      >
                        {step.detail}
                      </Body>
                    </Stack>
                  </Row>
                ))}
              </Stack>

              {mine ? (
                <Stack
                  padding="$3"
                  borderRadius="$4"
                  backgroundColor="$surfaceVariant"
                  gap="$2"
                >
                  <Row justifyContent="space-between" alignItems="center">
                    <Body fontSize={12}>
                      {t("predict.settlement.yourPosition")}
                    </Body>
                    <InlineText
                      fontWeight="800"
                      color={mine.outcome === "yes" ? "$success" : "$danger"}
                    >
                      {outcomeLabel(mine.outcome)} ·{" "}
                      {fill(t("predict.positions.shares"), { n: mine.shares })}
                    </InlineText>
                  </Row>
                  <Row justifyContent="space-between">
                    <Body fontSize={12}>{t("predict.settlement.cost")}</Body>
                    <InlineText fontSize={12} fontWeight="700">
                      {formatMoney(mine.costBasis, locale)}
                    </InlineText>
                  </Row>
                  {adj.proposedOutcome ? (
                    <Row justifyContent="space-between">
                      <Body fontSize={12}>
                        {fill(t("predict.settlement.ifHolds"), {
                          outcome: outcomeLabel(adj.proposedOutcome),
                        })}
                      </Body>
                      <InlineText
                        fontSize={12}
                        fontWeight="700"
                        color={
                          adj.proposedOutcome === mine.outcome
                            ? "$pricePositive"
                            : "$priceNegative"
                        }
                      >
                        {adj.proposedOutcome === mine.outcome
                          ? fill(t("predict.settlement.wins"), {
                              amount: formatMoney(
                                {
                                  ...mine.costBasis,
                                  raw: String(
                                    BigInt(Math.round(mine.shares * 1e6)),
                                  ),
                                },
                                locale,
                              ),
                            })
                          : fill(t("predict.settlement.zeroed"), {
                              amount: `−${formatMoney(mine.costBasis, locale)}`,
                            })}
                      </InlineText>
                    </Row>
                  ) : null}
                </Stack>
              ) : null}

              <Stack gap="$2">
                <PrimaryButton onPress={onBack}>
                  {t("predict.settlement.gotIt")}
                </PrimaryButton>
                {adj.canDispute && address ? (
                  <SecondaryButton
                    borderColor="$primary"
                    color="$primary"
                    onPress={() => disputeSheet.current?.present()}
                    testID="settlement-dispute"
                  >
                    {adj.bond
                      ? fill(t("predict.settlement.dispute"), {
                          bond: formatMoney(adj.bond, locale),
                        })
                      : t("predict.dispute.title")}
                  </SecondaryButton>
                ) : adj.status === "disputed" ||
                  adj.status === "arbitrating" ? (
                  <Body fontSize={12} testID="settlement-disputed">
                    {t("predict.dispute.disputed")}
                  </Body>
                ) : null}
                {/* crypto_periodic 由可信提案人直接结算，没有争议环节 */}
                {adj.adapter === "crypto_periodic" ? (
                  <Body fontSize={11}>{t("predict.dispute.noWindow")}</Body>
                ) : (
                  <Body fontSize={11}>
                    {t("predict.settlement.disputeNote")}
                  </Body>
                )}
              </Stack>
            </>
          ) : (
            <SettlementSkeleton />
          )}
        </Content>
      </PageScroll>
      {adj && address ? (
        <DisputeSheet
          ref={disputeSheet}
          marketId={marketId}
          address={address}
          adjudication={adj}
          onSubmitted={() => void adjudication.refetch()}
        />
      ) : null}
    </Page>
  );
}
