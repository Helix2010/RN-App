import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { useMemo, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { useGateways } from "../../../core/gateways/gateway-context";
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
  Stack,
  toast,
  useTheme,
} from "../../../design-system";
import type { RootStackParamList } from "../../../navigation/types";
import { useSession } from "../../session/hooks/use-session";
import { useWalletAccounts } from "../hooks/use-wallet";

/** Mock 助记词（真实实现由钱包服务派生，绝不落盘明文）。 */
const WORDS = [
  "ripple",
  "harbor",
  "velvet",
  "orbit",
  "candle",
  "meadow",
  "silver",
  "anchor",
  "pioneer",
  "glacier",
  "timber",
  "lantern",
];
const DECOYS = [
  "falcon",
  "marble",
  "prism",
  "cobalt",
  "summit",
  "ember",
  "quartz",
  "willow",
];

function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, String(value)),
    template,
  );
}

function shuffle<T>(items: T[], seed: number): T[] {
  const list = [...items];
  let state = seed;
  for (let index = list.length - 1; index > 0; index -= 1) {
    state = (state * 9301 + 49297) % 233280;
    const swap = Math.floor((state / 233280) * (index + 1));
    [list[index], list[swap]] = [list[swap] as T, list[index] as T];
  }
  return list;
}

/** L-04 备份助记词：抄写 → 验证（乱序选词 3 个）→ 完成；三段进度；可"稍后备份"。 */
export function BackupScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "WalletBackup">) {
  const insets = useSafeAreaInsets();
  const { t } = useFoundationRuntime();
  const theme = useTheme();
  const { wallet } = useGateways();
  const queryClient = useQueryClient();
  const session = useSession();
  const accounts = useWalletAccounts();
  const embedded =
    (accounts.data ?? []).find((item) => item.connector === "embedded") ??
    (session.data?.connector === "embedded"
      ? { address: session.data.address }
      : undefined);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [wrong, setWrong] = useState(false);
  const targets = useMemo(
    () =>
      shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 7)
        .slice(0, 3)
        .sort((a, b) => a - b),
    [],
  );
  const options = useMemo(
    () =>
      Object.fromEntries(
        targets.map((index, position) => [
          index,
          shuffle(
            [WORDS[index] as string, ...shuffle(DECOYS, index + 1).slice(0, 3)],
            position + 11,
          ),
        ]),
      ) as Record<number, string[]>,
    [targets],
  );

  const copy = async () => {
    await Clipboard.setStringAsync(WORDS.join(" "));
    toast(t("backup.copied"), "success");
    setTimeout(() => void Clipboard.setStringAsync(""), 60_000);
  };
  const verify = async () => {
    const ok = targets.every((index) => answers[index] === WORDS[index]);
    if (!ok) {
      setWrong(true);
      toast(t("backup.wrong"), "error");
      return;
    }
    if (embedded) await wallet.markBackedUp(embedded.address);
    void queryClient.invalidateQueries({ queryKey: ["wallet-accounts"] });
    setStep(3);
  };

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={t("backup.title")}
          subtitle={fill(t("backup.step"), { n: step, total: 3 })}
          onBack={() => navigation.goBack()}
          backLabel={t("action.back")}
        />
        <Row gap="$1.5" paddingBottom="$2">
          {[1, 2, 3].map((index) => (
            <Stack
              key={index}
              flex={1}
              height={4}
              borderRadius={2}
              backgroundColor={index <= step ? "$primary" : "$surfaceVariant"}
            />
          ))}
        </Row>
      </Content>
      <PageScroll>
        <Content paddingTop="$1" gap="$4" paddingBottom={40}>
          {step === 1 ? (
            <>
              <Stack gap="$1">
                <SectionTitle fontSize={18}>{t("backup.heading")}</SectionTitle>
                <Body>{t("backup.hint")}</Body>
              </Stack>
              <Row flexWrap="wrap" gap="$2">
                {WORDS.map((word, index) => (
                  <Row
                    key={word}
                    width="31%"
                    alignItems="center"
                    gap="$2"
                    paddingHorizontal="$3"
                    paddingVertical="$2.5"
                    borderRadius="$3"
                    backgroundColor="$surfaceVariant"
                    testID={`backup-word-${index + 1}`}
                  >
                    <InlineText fontSize={12} color="$textMuted" width={18}>
                      {index + 1}
                    </InlineText>
                    <InlineText fontWeight="700">{word}</InlineText>
                  </Row>
                ))}
              </Row>
              <SecondaryButton
                onPress={() => void copy()}
                testID="backup-copy"
                icon={<AppIcon name="content-copy" size={18} />}
              >
                {t("backup.copy")}
              </SecondaryButton>
              <Row
                alignItems="center"
                gap="$2"
                padding="$3"
                borderRadius="$4"
                style={{ backgroundColor: `${theme.warning.val}22` }}
              >
                <AppIcon
                  name="camera-off-outline"
                  size={18}
                  colorToken="warning"
                />
                <Body flex={1} fontSize={12} color="$warning">
                  {t("backup.noScreenshot")}
                </Body>
              </Row>
              <PrimaryButton onPress={() => setStep(2)} testID="backup-next">
                {t("backup.next")}
              </PrimaryButton>
              <SecondaryButton
                onPress={() => navigation.goBack()}
                testID="backup-later"
              >
                {t("backup.later")}
              </SecondaryButton>
            </>
          ) : step === 2 ? (
            <>
              <Stack gap="$1">
                <SectionTitle fontSize={18}>
                  {t("backup.verifyHeading")}
                </SectionTitle>
                <Body>{t("backup.verifyHint")}</Body>
              </Stack>
              {targets.map((index) => (
                <Stack key={index} gap="$2">
                  <Body fontSize={12}>
                    {fill(t("backup.wordAt"), { n: index + 1 })}
                  </Body>
                  <Row gap="$2" flexWrap="wrap">
                    {(options[index] ?? []).map((word) => {
                      const selected = answers[index] === word;
                      return (
                        <Stack
                          key={word}
                          paddingHorizontal="$3"
                          paddingVertical="$2"
                          borderRadius={999}
                          backgroundColor={
                            selected ? "$primary" : "$surfaceVariant"
                          }
                          borderWidth={
                            wrong && selected && word !== WORDS[index] ? 1.5 : 0
                          }
                          borderColor="$danger"
                          onPress={() => {
                            setWrong(false);
                            setAnswers((prev) => ({ ...prev, [index]: word }));
                          }}
                          accessibilityRole="radio"
                          accessibilityState={{ selected }}
                          testID={`backup-pick-${index + 1}-${word}`}
                        >
                          <InlineText
                            fontWeight="700"
                            color={selected ? "$onPrimary" : "$color"}
                          >
                            {word}
                          </InlineText>
                        </Stack>
                      );
                    })}
                  </Row>
                </Stack>
              ))}
              <PrimaryButton
                disabled={targets.some((index) => !answers[index])}
                onPress={() => void verify()}
                testID="backup-verify"
              >
                {t("common.confirm")}
              </PrimaryButton>
              <SecondaryButton onPress={() => setStep(1)}>
                {t("action.back")}
              </SecondaryButton>
            </>
          ) : (
            <Stack alignItems="center" gap="$3" paddingVertical="$6">
              <Stack
                width={72}
                height={72}
                borderRadius={36}
                backgroundColor="$success"
                alignItems="center"
                justifyContent="center"
              >
                <AppIcon name="check" size={36} colorToken="onPrimary" />
              </Stack>
              <SectionTitle fontSize={20}>{t("backup.done")}</SectionTitle>
              <Body textAlign="center">{t("backup.doneHint")}</Body>
              <PrimaryButton
                alignSelf="stretch"
                onPress={() => navigation.goBack()}
                testID="backup-finish"
              >
                {t("backup.finish")}
              </PrimaryButton>
            </Stack>
          )}
        </Content>
      </PageScroll>
    </Page>
  );
}
