import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { fill } from "../../../core/i18n/format";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { useGateways } from "../../../core/gateways/gateway-context";
import { useScreenProtect } from "../../../core/security/screen-protect";
import {
  ActionButton,
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
  useAsyncAction,
  useTheme,
} from "../../../design-system";
import type { RootStackParamList } from "../../../navigation/types";
import { useSession } from "../../session/hooks/use-session";
import { MAX_QUIZ_ATTEMPTS, buildQuiz } from "../model/backup-quiz";
import { takePendingPhrase } from "../model/pending-reveal";
import { useWalletAccounts } from "../hooks/use-wallet";

/**
 * 一句合法 BIP-39 助记词的词数。12 与 24 都要支持（安全评审 N29：新钱包默认 24
 * 词，界面允许用户选 12），所以这里不能再写死一个数——写死会让 24 词的钱包
 * 永远通不过验证那一步。
 */
const VALID_WORD_COUNTS = new Set([12, 24]);

/** L-04 备份助记词：抄写 → 验证（乱序选词 3 个）→ 完成；三段进度；可"稍后备份"。 */
export function BackupScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "WalletBackup">) {
  const insets = useSafeAreaInsets();
  const { t } = useFoundationRuntime();
  const theme = useTheme();
  const { wallet } = useGateways();
  // 助记词页必须挡住截图 / 录屏
  const screenProtect = useScreenProtect("wallet-seed-phrase");
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
  const [attempts, setAttempts] = useState(0);
  /** 答错满三次就换一套题；不换的话退回去再进来还是原来那三个位置，等于可以穷举 */
  const [quizRound, setQuizRound] = useState(0);
  // 刚创建的钱包把助记词经模块级一次性通道交过来（不进导航参数，安全评审 N36），
  // 避免紧接着再弹一次身份验证；从设置页进来则必须现场解封（会弹系统验证）。
  const [phrase, setPhrase] = useState<string | null>(() =>
    takePendingPhrase(),
  );
  const [revealError, setRevealError] = useState(false);
  const address = embedded?.address;
  useEffect(() => {
    if (phrase !== null || !address) return;
    let cancelled = false;
    void wallet
      .revealMnemonic(address, "backup.revealReason")
      .then((value) => {
        if (!cancelled) setPhrase(value);
      })
      .catch(() => {
        if (!cancelled) setRevealError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [address, phrase, t, wallet]);
  const words = useMemo(() => (phrase ? phrase.split(" ") : []), [phrase]);
  // 每次进入都重新随机：位置和干扰词固定时，旁观者看一次就知道下次考哪几个。
  // `quizRound` 变了也重出题：连续错满退回抄写页之后不能还是原来那套。
  const quiz = useMemo(
    () => buildQuiz(words, { targetCount: 3, decoyCount: 3 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- quizRound 是"重新出题"的信号，不参与计算
    [words, quizRound],
  );
  const targets = quiz.targets;
  const options = quiz.choices;

  /*
   * 这里曾经有一个"复制助记词"按钮（安全评审 N23）。**已经移除，不要加回来。**
   *
   * 系统剪贴板是应用外的共享缓冲区：同设备的任何应用都能读，第三方输入法能读，
   * Android 的剪贴板历史和跨设备同步也会把它带走。定时抹除只缩短了窗口，改变不了
   * "助记词离开了这个应用"这件事——而助记词泄露是不可逆、全部资金、永久有效的。
   *
   * 抄写是慢，但慢正是这一步该有的样子。
   */
  /**
   * 备份完成之后才引导设置口令（安全评审 N6 / 方案 §3.5）。
   *
   * 顺序是有意的：忘记口令无法找回，而换锁屏或重录生物识别之后系统会作废那把
   * 认证绑定的密钥，届时只能靠口令重新打开钱包。放在用户已经抄下助记词之后，
   * 最坏情况才有退路。已经开过口令的（导入到同一个金库）不再打扰。
   */
  const finish = async () => {
    try {
      if (!(await wallet.isPassphraseProtected())) {
        navigation.replace("WalletPassphrase");
        return;
      }
    } catch {
      // 问不出来就当成已经开过：这一步是加固引导，不能因为它让用户卡在备份页
    }
    navigation.goBack();
  };

  const { run: verify, pending: marking } = useAsyncAction(
    async () => {
      const ok =
        VALID_WORD_COUNTS.has(words.length) &&
        targets.every((index) => answers[index] === words[index]);
      if (!ok) {
        setWrong(true);
        const used = attempts + 1;
        setAttempts(used);
        toast(t("backup.wrong"), "error");
        // 连续错满就退回抄写页重看，不让用户在四选一里穷举（安全评审 N25）
        if (used >= MAX_QUIZ_ATTEMPTS) {
          setAttempts(0);
          setAnswers({});
          setWrong(false);
          setStep(1);
          // 换一套题：只归零计数的话，退回去再进来考的还是同样三个位置
          setQuizRound((round) => round + 1);
          toast(t("backup.rereadAfterMisses"), "error");
        }
        return false;
      }
      // 答对了但这一步失败过去是静默的：用户停在原页面，不知道备份没记上
      if (embedded) await wallet.markBackedUp(embedded.address);
      void queryClient.invalidateQueries({ queryKey: ["wallet-accounts"] });
      setStep(3);
    },
    { failureMessage: t("backup.markFailed") },
  );

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
          {step === 1 && !phrase ? (
            <Stack gap="$3" testID="backup-locked">
              <SectionTitle fontSize={18}>
                {revealError ? t("backup.revealFailed") : t("backup.locked")}
              </SectionTitle>
              {revealError ? (
                <SecondaryButton
                  onPress={() => {
                    setRevealError(false);
                    setPhrase(null);
                  }}
                  testID="backup-retry"
                >
                  {t("backup.retry")}
                </SecondaryButton>
              ) : null}
            </Stack>
          ) : step === 1 ? (
            <>
              <Stack gap="$1">
                <SectionTitle fontSize={18}>
                  {/* 文案按实际词数取：translateMessage 不支持插值，所以是两个键 */}
                  {t(words.length === 24 ? "backup.heading24" : "backup.heading")}
                </SectionTitle>
                <Body>{t("backup.hint")}</Body>
              </Stack>
              {screenProtect === "unavailable" ? (
                <Row
                  alignItems="flex-start"
                  gap="$2"
                  padding="$3"
                  borderRadius="$4"
                  style={{ backgroundColor: `${theme.warning.val}22` }}
                  testID="backup-screen-protect-warning"
                >
                  <AppIcon
                    name="alert-outline"
                    size={18}
                    colorToken="warning"
                  />
                  <Body flex={1} fontSize={12} color="$warning">
                    {t("backup.screenProtectUnavailable")}
                  </Body>
                </Row>
              ) : null}
              {/* 保护还没落地就先不画单词：先画出来再加 FLAG_SECURE，
                  中间这一帧是可以被截走的（安全评审 N24） */}
              <Row flexWrap="wrap" gap="$2">
                {(screenProtect === "pending" ? [] : words).map(
                  (word, index) => (
                    <Row
                      // 助记词可能重复（12 词里同一个词出现两次是合法的），键要带位置
                      key={`${index}-${word}`}
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
                  ),
                )}
              </Row>
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
                    {(options[index] ?? []).map((word, optionIndex) => {
                      const selected = answers[index] === word;
                      return (
                        <Stack
                          key={`${index}-${optionIndex}`}
                          paddingHorizontal="$3"
                          paddingVertical="$2"
                          borderRadius={999}
                          backgroundColor={
                            selected ? "$primary" : "$surfaceVariant"
                          }
                          borderWidth={
                            wrong && selected && word !== words[index] ? 1.5 : 0
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
              <ActionButton
                disabled={targets.some((index) => !answers[index])}
                loading={marking}
                loadingLabel={t("common.processing")}
                onPress={() => verify()}
                testID="backup-verify"
              >
                {t("common.confirm")}
              </ActionButton>
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
                onPress={() => void finish()}
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
