import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useFoundationRuntime } from "../../../app/runtime-context";
import {
  fill,
  formatCountdown,
  formatMoney,
  formatTokenAmount,
} from "../../../core/i18n/format";
import { mockNow } from "../../../core/mock/mock-runtime";
import { compare, toApproxNumber, sub } from "../../../core/money/money";
import {
  AppIcon,
  Body,
  InlineText,
  PrimaryButton,
  Row,
  SecondaryButton,
  SectionTitle,
  Sheet,
  SkeletonBlock,
  Stack,
  TextField,
  toast,
  type SheetHandle,
} from "../../../design-system";
import { useRequireVerification } from "../../security/use-require-verification";
import {
  useDisputeTerms,
  useSubmitDispute,
  useWrapForDispute,
} from "../hooks/use-predict";
import {
  DISPUTE_EVIDENCE_MAX,
  DISPUTE_EVIDENCE_MIN,
  DISPUTE_MAX_LINKS,
  PredictDisputeError,
  PredictInsufficientBondError,
  validateDisputeInput,
} from "../model/dispute";
import type { Adjudication, DisputeStep } from "../model/predict";

const STEP_KEYS: Record<DisputeStep, string> = {
  evidence: "predict.dispute.step.evidence",
  bond: "predict.dispute.step.bond",
  approve: "predict.dispute.step.approve",
  dispute: "predict.dispute.step.dispute",
};

/**
 * 提出争议（review-2026-09-05 §4.3，对齐网页 RaiseDisputeModal）：证据（150–1000 字）+ 最多 5 条
 * https 链接 + 押金行（押金 / 本地址 USDW / 不足则一键兑换）+ 链上到期倒计时 + 四步进度。
 * 押金与到期只在面板打开时读链；倒计时以链上 expirationTime 为准。
 */
export const DisputeSheet = forwardRef<
  SheetHandle,
  {
    marketId: string;
    address: string;
    adjudication: Adjudication;
    onSubmitted: () => void;
  }
>(function DisputeSheet({ marketId, address, adjudication, onSubmitted }, ref) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const sheet = useRef<SheetHandle>(null);
  const [open, setOpen] = useState(false);
  useImperativeHandle(
    ref,
    () => ({
      present: () => {
        setOpen(true);
        sheet.current?.present();
      },
      dismiss: () => {
        setOpen(false);
        sheet.current?.dismiss();
      },
    }),
    [],
  );
  const [evidence, setEvidence] = useState("");
  const [links, setLinks] = useState<string[]>([""]);
  const [showErrors, setShowErrors] = useState(false);
  const [step, setStep] = useState<
    DisputeStep | "approve-usdc" | "wrap" | null
  >(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [now, setNow] = useState(mockNow());
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(mockNow()), 1_000);
    return () => clearInterval(timer);
  }, [open]);
  const terms = useDisputeTerms(address, marketId, open);
  const submit = useSubmitDispute(address);
  const wrap = useWrapForDispute(address);
  const verify = useRequireVerification();

  const validation = validateDisputeInput({ evidence, links });
  const bond = terms.data?.bond;
  const shortfall =
    terms.data && compare(terms.data.usdwBalance, terms.data.bond) < 0
      ? sub(terms.data.bond, terms.data.usdwBalance)
      : null;
  const canWrap =
    shortfall !== null &&
    terms.data !== undefined &&
    compare(terms.data.usdcBalance, {
      ...shortfall,
      symbol: terms.data.usdcBalance.symbol,
    }) >= 0;
  const expired =
    terms.data !== undefined && now >= new Date(terms.data.expiresAt).getTime();
  const busy = submit.isPending || wrap.isPending;

  const describe = (error: unknown): string => {
    if (error instanceof PredictInsufficientBondError)
      return fill(t("predict.dispute.bond.insufficient"), {
        amount: formatMoney(error.shortfall, locale),
      });
    if (error instanceof PredictDisputeError)
      return fill(t(`predict.dispute.error.${error.reason}`), {
        detail: error.detail,
      });
    return error instanceof Error ? error.message : String(error);
  };

  const onSubmit = async () => {
    setFailure(null);
    if (!validation.ok || !terms.data) {
      setShowErrors(true);
      return;
    }
    const ok = await verify({
      usdValue: toApproxNumber(terms.data.bond),
      reason: t("predict.dispute.verifyReason"),
    });
    if (!ok) return;
    submit.mutate(
      { marketId, evidence, links, onStep: setStep },
      {
        onSuccess: () => {
          setStep(null);
          toast(t("predict.settlement.disputeSubmitted"), "success");
          onSubmitted();
          setOpen(false);
          sheet.current?.dismiss();
        },
        onError: (error) => {
          setStep(null);
          setFailure(describe(error));
        },
      },
    );
  };

  const onWrap = () => {
    if (!shortfall) return;
    setFailure(null);
    wrap.mutate(
      {
        amount: { ...shortfall, symbol: "USDC" },
        onStep: (next) => setStep(next === "approve" ? "approve-usdc" : "wrap"),
      },
      {
        onSuccess: () => {
          setStep(null);
          toast(t("predict.dispute.bond.wrapped"), "success");
        },
        onError: (error) => {
          setStep(null);
          setFailure(describe(error));
        },
      },
    );
  };

  const stepLabel =
    step === null
      ? null
      : step === "approve-usdc"
        ? t("predict.dispute.step.approveUsdc")
        : step === "wrap"
          ? t("predict.dispute.step.wrap")
          : t(STEP_KEYS[step]);

  return (
    <Sheet
      ref={sheet}
      onDismiss={() => setOpen(false)}
      title={t("predict.dispute.title")}
      closeLabel={t("common.close")}
      locked={busy}
      scroll
      testID="dispute-sheet"
    >
      <Stack gap="$1">
        <SectionTitle fontSize={14}>
          {t("predict.dispute.evidence.label")}
        </SectionTitle>
        <TextField
          value={evidence}
          onChangeText={setEvidence}
          multiline
          placeholder={t("predict.dispute.evidence.placeholder")}
          accessibilityLabel={t("predict.dispute.evidence.label")}
          testID="dispute-evidence"
          error={
            showErrors && validation.evidenceError
              ? fill(
                  t(`predict.dispute.evidence.${validation.evidenceError}`),
                  {
                    min: DISPUTE_EVIDENCE_MIN,
                    max: DISPUTE_EVIDENCE_MAX,
                  },
                )
              : undefined
          }
        />
        <Body
          fontSize={11}
          color={
            validation.evidenceError && showErrors ? "$danger" : "$textMuted"
          }
          testID="dispute-evidence-count"
        >
          {fill(t("predict.dispute.evidence.count"), {
            n: validation.evidenceChars,
            min: DISPUTE_EVIDENCE_MIN,
            max: DISPUTE_EVIDENCE_MAX,
          })}
        </Body>
      </Stack>

      <Stack gap="$1">
        <SectionTitle fontSize={14}>
          {fill(t("predict.dispute.links.label"), { max: DISPUTE_MAX_LINKS })}
        </SectionTitle>
        {links.map((link, index) => (
          <TextField
            key={index}
            value={link}
            onChangeText={(next) =>
              setLinks((current) =>
                current.map((item, position) =>
                  position === index ? next : item,
                ),
              )
            }
            placeholder="https://"
            autoCapitalize="none"
            keyboardType="url"
            accessibilityLabel={`${t("predict.dispute.links.label")} ${index + 1}`}
            testID={`dispute-link-${index}`}
            error={
              showErrors &&
              link.trim() !== "" &&
              validation.invalidLinks.includes(
                links.slice(0, index + 1).filter((item) => item.trim() !== "")
                  .length - 1,
              )
                ? t("predict.dispute.links.invalid")
                : undefined
            }
            trailing={
              links.length > 1 ? (
                <Row
                  onPress={() =>
                    setLinks((current) =>
                      current.filter((_, position) => position !== index),
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel={t("common.close")}
                >
                  <AppIcon name="close" size={16} colorToken="textMuted" />
                </Row>
              ) : undefined
            }
          />
        ))}
        {links.length < DISPUTE_MAX_LINKS ? (
          <SecondaryButton
            onPress={() => setLinks((current) => [...current, ""])}
            testID="dispute-link-add"
          >
            {t("predict.dispute.links.add")}
          </SecondaryButton>
        ) : null}
      </Stack>

      <Stack
        padding="$3"
        borderRadius="$4"
        backgroundColor="$surfaceVariant"
        gap="$2"
        testID="dispute-terms"
      >
        {terms.data ? (
          <>
            <Row justifyContent="space-between">
              <Body fontSize={12}>{t("predict.dispute.bond.label")}</Body>
              <InlineText fontSize={13} fontWeight="800">
                {formatMoney(terms.data.bond, locale)}
              </InlineText>
            </Row>
            <Row justifyContent="space-between">
              <Body fontSize={12}>{t("predict.dispute.bond.balance")}</Body>
              <InlineText
                fontSize={12}
                fontWeight="700"
                color={shortfall ? "$danger" : "$color"}
              >
                {formatMoney(terms.data.usdwBalance, locale)}
              </InlineText>
            </Row>
            {shortfall ? (
              <Stack gap="$2">
                <Body fontSize={12} color="$danger" testID="dispute-shortfall">
                  {fill(t("predict.dispute.bond.insufficient"), {
                    amount: formatMoney(shortfall, locale),
                  })}
                </Body>
                {canWrap ? (
                  <SecondaryButton
                    disabled={busy}
                    onPress={onWrap}
                    testID="dispute-wrap"
                  >
                    {fill(t("predict.dispute.bond.wrap"), {
                      amount: formatMoney(shortfall, locale),
                    })}
                  </SecondaryButton>
                ) : (
                  <Body fontSize={12}>
                    {t("predict.dispute.bond.wrapUnavailable")}
                  </Body>
                )}
              </Stack>
            ) : null}
            <Row justifyContent="space-between">
              <Body fontSize={12}>{t("predict.dispute.gas")}</Body>
              <InlineText fontSize={12} fontWeight="700">
                {formatTokenAmount(terms.data.nativeBalance, 6, locale, {
                  withSymbol: true,
                })}
              </InlineText>
            </Row>
            <Body
              fontSize={12}
              color={expired ? "$danger" : "$warning"}
              testID="dispute-countdown"
            >
              {expired
                ? t("predict.dispute.closed")
                : fill(t("predict.dispute.expires"), {
                    time: formatCountdown(terms.data.expiresAt, now),
                  })}
            </Body>
          </>
        ) : terms.isError ? (
          <Body fontSize={12} color="$danger" testID="dispute-terms-error">
            {describe(terms.error)}
          </Body>
        ) : (
          // 押金 / 余额 / 手续费 / 倒计时 四行，与读到条款后的布局同形
          <Stack gap="$2" testID="dispute-terms-skeleton">
            {[0, 1, 2].map((index) => (
              <Row key={index} justifyContent="space-between">
                <SkeletonBlock height={12} width={72} />
                <SkeletonBlock height={12} width={96} />
              </Row>
            ))}
            <SkeletonBlock height={12} width={200} />
          </Stack>
        )}
      </Stack>
      <Body fontSize={11}>{t("predict.dispute.bond.note")}</Body>
      {stepLabel ? (
        <Body fontSize={12} color="$primary" testID="dispute-step">
          {stepLabel}
        </Body>
      ) : null}
      {failure ? (
        <Body fontSize={12} color="$danger" testID="dispute-error">
          {failure}
        </Body>
      ) : null}
      <PrimaryButton
        disabled={
          busy ||
          !terms.data ||
          expired ||
          shortfall !== null ||
          !adjudication.canDispute
        }
        onPress={() => void onSubmit()}
        testID="dispute-submit"
      >
        {submit.isPending
          ? t("login.signing")
          : fill(t("predict.dispute.submit"), {
              bond: bond ? formatMoney(bond, locale) : "",
            })}
      </PrimaryButton>
    </Sheet>
  );
});
