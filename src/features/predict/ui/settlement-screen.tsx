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
  InlineText,
  Page,
  PageScroll,
  PrimaryButton,
  Row,
  ScreenHeader,
  SecondaryButton,
  SectionTitle,
  Sheet,
  type SheetHandle,
  SkeletonBlock,
  Stack,
  TextField,
  toast,
} from "../../../design-system";
import { useSession } from "../../session/hooks/use-session";
import {
  useAdjudication,
  usePositions,
  usePredictEvent,
  useSubmitDispute,
} from "../hooks/use-predict";
import { EVENTS } from "../fixtures/events";
import { StatusBadge, fill, outcomeLabel } from "./shared";

/** P-04 结算进度与争议：四步进度条（倒计时是唯一 warn 色）、你的持仓、提出争议（押金）。 */
export function SettlementScreen({
  marketId,
  onBack,
}: {
  marketId: string;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const session = useSession();
  const address = session.data?.address;
  const eventId = EVENTS.find((event) =>
    event.markets.some((market) => market.id === marketId),
  )?.id;
  const event = usePredictEvent(eventId);
  const adjudication = useAdjudication(marketId);
  const positions = usePositions(address, true);
  const dispute = useSubmitDispute(address);
  const disputeSheet = useRef<SheetHandle>(null);
  const [reason, setReason] = useState("");
  const [now, setNow] = useState(mockNow());
  const adj = adjudication.data;
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

  const submitDispute = () => {
    dispute.mutate(
      { marketId, reason },
      {
        onSuccess: () => {
          disputeSheet.current?.dismiss();
          toast(t("predict.settlement.disputeSubmitted"), "success");
        },
        onError: () => toast(t("state.error"), "error"),
      },
    );
  };

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
              <Stack gap="$0">
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
                    {fill(t("predict.settlement.dispute"), {
                      bond: formatMoney(adj.bond, locale),
                    })}
                  </SecondaryButton>
                ) : null}
                <Body fontSize={11}>{t("predict.settlement.disputeNote")}</Body>
              </Stack>
            </>
          ) : (
            <Stack gap="$3">
              <SkeletonBlock height={24} width={240} />
              <SkeletonBlock height={200} />
            </Stack>
          )}
        </Content>
      </PageScroll>
      <Sheet
        ref={disputeSheet}
        title={fill(t("predict.settlement.dispute"), {
          bond: adj ? formatMoney(adj.bond, locale) : "",
        })}
        closeLabel={t("common.close")}
        locked={dispute.isPending}
      >
        <TextField
          value={reason}
          onChangeText={setReason}
          placeholder={t("predict.settlement.disputeReason")}
          accessibilityLabel={t("predict.settlement.disputeReason")}
          testID="dispute-reason"
        />
        <Body fontSize={12}>{t("predict.settlement.disputeNote")}</Body>
        <PrimaryButton
          disabled={dispute.isPending}
          onPress={submitDispute}
          testID="dispute-submit"
        >
          {dispute.isPending ? t("login.signing") : t("common.confirm")}
        </PrimaryButton>
      </Sheet>
    </Page>
  );
}
