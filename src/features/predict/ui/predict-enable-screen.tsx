import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { fill, shortenAddress } from "../../../core/i18n/format";
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
  useEnablePredict,
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
  const { t } = useFoundationRuntime();
  const session = useSession();
  const address = session.data?.address;
  const enablement = usePredictEnablement(address);
  const enable = useEnablePredict(address);
  const requireVerification = useRequireVerification();
  const status = enablement.data;
  const complete = status ? enablementComplete(status) : false;
  const started = status ? STEPS.some((step) => stepDone(status, step)) : false;

  const run = async () => {
    if (!(await requireVerification())) return;
    enable.mutate(undefined, {
      onSuccess: () => {
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
                    const done = stepDone(status, step);
                    const active = enable.step === step;
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
            <PrimaryButton
              disabled={!status || complete || enable.isPending}
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
