import { useState } from "react";
import { Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { fill, shortenAddress } from "../../../core/i18n/format";
import {
  pickAgreementText,
  type PlatformAgreement,
} from "../../../core/predict-platform/agreements";
import {
  AppIcon,
  Body,
  Content,
  InlineText,
  Page,
  PageScroll,
  PageState,
  PrimaryButton,
  Row,
  ScreenHeader,
  SecondaryButton,
  SectionTitle,
  SkeletonBlock,
  Spinner,
  Stack,
  toast,
} from "../../../design-system";
import { useRequireVerification } from "../../security/use-require-verification";
import { useSession } from "../../session/hooks/use-session";
import { requestAuth } from "../../session/model/auth-sheet-store";
import {
  enablementComplete,
  type EnablementStep,
  type PredictEnablement,
} from "../api/account-gateway";
import {
  useAcceptAgreements,
  useEnablePredict,
  usePlatformAgreements,
  usePredictEnablement,
} from "../hooks/use-predict-account";

const STEPS: EnablementStep[] = ["login", "deploySafe", "clobKey", "approve"];

function stepDone(status: PredictEnablement, step: EnablementStep): boolean {
  switch (step) {
    case "login":
      return status.loggedIn;
    case "deploySafe":
      return status.safe !== null && status.safe.deployed;
    case "clobKey":
      return status.clobKey;
    case "approve":
      return status.approved;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 平台协议正文用 `**` 标重点（实测 dev），这里只显示纯文本。 */
function plainText(text: string | undefined): string | undefined {
  return text?.replace(/\*\*/g, "");
}

function AgreementRow({
  item,
  locale,
  pending,
  viewLabel,
  requiredLabel,
}: {
  item: PlatformAgreement;
  locale: string;
  pending: boolean;
  viewLabel: string;
  requiredLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const title = pickAgreementText(item.titleTranslation, locale) ?? item.type;
  const url = pickAgreementText(item.externalUrl, locale);
  const content = plainText(pickAgreementText(item.contentTranslation, locale));
  return (
    <Stack
      gap="$1"
      padding="$3"
      borderRadius="$4"
      backgroundColor="$surfaceVariant"
      testID={`predict-agreement-${item.type}`}
    >
      <Row alignItems="center" gap="$2">
        <SectionTitle fontSize={13} flex={1}>
          {title}
        </SectionTitle>
        {pending ? (
          <InlineText fontSize={10} fontWeight="800" color="$primary">
            {requiredLabel}
          </InlineText>
        ) : null}
        {url ? (
          <Row
            onPress={() => void Linking.openURL(url)}
            accessibilityRole="link"
            testID={`predict-agreement-open-${item.type}`}
          >
            <InlineText fontSize={12} color="$primary" fontWeight="700">
              {viewLabel}
            </InlineText>
          </Row>
        ) : content ? (
          <Row
            onPress={() => setExpanded((prev) => !prev)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            testID={`predict-agreement-toggle-${item.type}`}
          >
            <AppIcon
              name={expanded ? "chevron-up" : "chevron-down"}
              size={18}
              colorToken="textMuted"
            />
          </Row>
        ) : null}
      </Row>
      {expanded && content ? <Body fontSize={12}>{content}</Body> : null}
    </Stack>
  );
}

/**
 * 预测账户启用引导：四步（登录 / 建 Safe / 交易凭证 / 授权）幂等地跑完缺的那几步。
 * 每步都要用钱包签名，所以先过安全验证；进行中的一步显示 spinner。
 */
export function PredictEnableScreen({
  onBack,
  onDone,
}: {
  onBack: () => void;
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const session = useSession();
  const address = session.data?.address;
  const enablement = usePredictEnablement(address);
  const enable = useEnablePredict(address);
  const requireVerification = useRequireVerification();
  const status = enablement.data;
  const complete = status ? enablementComplete(status) : false;
  const started = status ? STEPS.some((step) => stepDone(status, step)) : false;
  const locale = config.localization.selectedLocale;
  const agreements = usePlatformAgreements(Boolean(status?.configured));
  const accept = useAcceptAgreements();
  const [agreed, setAgreed] = useState(false);
  const pending = agreements.data?.pending ?? [];
  const pendingTypes = new Set(pending.map((item) => item.type));
  // 协议还没拿到就不能开始：必读项没确认前不签任何东西
  const agreementsBlock =
    agreements.data === undefined || (pending.length > 0 && !agreed);

  const run = async () => {
    if (!(await requireVerification())) return;
    enable.mutate(undefined, {
      onSuccess: () => {
        if (pending.length > 0) accept.mutate(pending);
        toast(t("predict.enable.done"), "success");
        onDone();
      },
      onError: (error) =>
        toast(`${t("predict.enable.failed")} ${messageOf(error)}`, "error"),
    });
  };

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={t("predict.enable.title")}
          onBack={onBack}
          backLabel={t("action.back")}
        />
      </Content>
      {!address ? (
        <PageState
          title={t("assets.signInToView")}
          action={
            <PrimaryButton onPress={() => requestAuth()}>
              {t("home.connectWallet")}
            </PrimaryButton>
          }
        />
      ) : status && !status.configured ? (
        <PageState title={t("predict.enable.notConfigured")} />
      ) : (
        <PageScroll>
          <Content paddingTop="$2" gap="$4" paddingBottom={40}>
            <Body>{t("predict.enable.intro")}</Body>
            <Stack gap="$2" testID="predict-enable-steps">
              {status
                ? STEPS.map((step, index) => {
                    // 服务端状态 ∪ 本次运行已完成的步骤：进行中每完成一步就打一个勾
                    const done =
                      stepDone(status, step) || enable.done.includes(step);
                    const active = enable.step === step && !done;
                    return (
                      <Row
                        key={step}
                        alignItems="center"
                        gap="$3"
                        padding="$3"
                        borderRadius="$4"
                        backgroundColor="$surfaceVariant"
                        testID={`predict-enable-step-${step}`}
                        accessibilityState={{ checked: done }}
                      >
                        <Stack
                          width={28}
                          height={28}
                          borderRadius={14}
                          alignItems="center"
                          justifyContent="center"
                          backgroundColor={done ? "$success" : "$surface"}
                          borderWidth={done ? 0 : 1}
                          borderColor="$borderColor"
                        >
                          {active ? (
                            <Spinner size="small" />
                          ) : done ? (
                            <AppIcon
                              name="check"
                              size={16}
                              colorToken="onPrimary"
                            />
                          ) : (
                            <InlineText fontSize={12} fontWeight="800">
                              {index + 1}
                            </InlineText>
                          )}
                        </Stack>
                        <Stack flex={1} gap="$0.5">
                          <SectionTitle fontSize={14}>
                            {t(`predict.enable.step.${step}`)}
                          </SectionTitle>
                          {step === "deploySafe" && status.safe ? (
                            <Body fontSize={11}>
                              {fill(t("predict.enable.safe"), {
                                address: shortenAddress(status.safe.address),
                              })}
                            </Body>
                          ) : null}
                        </Stack>
                      </Row>
                    );
                  })
                : [0, 1, 2, 3].map((index) => (
                    <SkeletonBlock key={index} height={56} />
                  ))}
            </Stack>
            {enablement.isError ? (
              <Body color="$priceNegative" fontSize={12}>
                {messageOf(enablement.error)}
              </Body>
            ) : null}
            {agreements.data && agreements.data.all.length > 0 ? (
              <Stack gap="$2" testID="predict-enable-agreements">
                <SectionTitle fontSize={14}>
                  {t("predict.enable.agreements")}
                </SectionTitle>
                {agreements.data.all.map((item) => (
                  <AgreementRow
                    key={item.type}
                    item={item}
                    locale={locale}
                    pending={pendingTypes.has(item.type)}
                    viewLabel={t("predict.enable.view")}
                    requiredLabel={t("predict.enable.agreementRequired")}
                  />
                ))}
                {pending.length > 0 && !complete ? (
                  <Row
                    alignItems="center"
                    gap="$2"
                    onPress={() => setAgreed((prev) => !prev)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: agreed }}
                    testID="predict-enable-agree"
                  >
                    <AppIcon
                      name={
                        agreed ? "checkbox-marked" : "checkbox-blank-outline"
                      }
                      size={20}
                      colorToken={agreed ? "primary" : "textMuted"}
                    />
                    <Body fontSize={12} flex={1}>
                      {t("predict.enable.agree")}
                    </Body>
                  </Row>
                ) : null}
              </Stack>
            ) : agreements.isError ? (
              <Body color="$priceNegative" fontSize={12}>
                {messageOf(agreements.error)}
              </Body>
            ) : null}
            <PrimaryButton
              disabled={
                !status || complete || enable.isPending || agreementsBlock
              }
              onPress={() => void run()}
              testID="predict-enable-run"
            >
              {enable.isPending
                ? t("common.processing")
                : complete
                  ? t("predict.enable.complete")
                  : started
                    ? t("predict.enable.resume")
                    : t("predict.enable.run")}
            </PrimaryButton>
            <SecondaryButton
              disabled={enable.isPending}
              onPress={complete ? onDone : onBack}
              testID="predict-enable-later"
            >
              {complete ? t("common.done") : t("predict.enable.later")}
            </SecondaryButton>
          </Content>
        </PageScroll>
      )}
    </Page>
  );
}
