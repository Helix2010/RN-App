import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { useGateways } from "../../../core/gateways/gateway-context";
import { isPassphraseAcceptable } from "../../../core/wallet/vault/passphrase";
import {
  AppIcon,
  Body,
  Content,
  Page,
  PageScroll,
  PrimaryButton,
  Row,
  ScreenHeader,
  SectionTitle,
  Stack,
  TextField,
  toast,
  useAsyncAction,
  useTheme,
} from "../../../design-system";
import type { RootStackParamList } from "../../../navigation/types";

/**
 * 开通流程的最后一步：给金库加一道只有用户知道的口令（安全评审 N6）。
 *
 * 它排在**备份之后**是有意的。忘记口令无法找回，而换锁屏或重录生物识别之后系统会
 * 作废那把认证绑定的密钥，届时只能靠口令重新打开钱包。把这一步放在用户已经抄下
 * 助记词之后，最坏情况才有退路——反过来的顺序会给一部分用户留下一颗定时炸弹。
 *
 * 可以跳过。这是加固，不是门禁；把它做成必填只会让一部分用户随手输一串记不住的
 * 东西，那比不开更糟。
 */
export function WalletPassphraseScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "WalletPassphrase">) {
  const insets = useSafeAreaInsets();
  const { t } = useFoundationRuntime();
  const theme = useTheme();
  const { wallet } = useGateways();
  const queryClient = useQueryClient();
  const [passphrase, setPassphrase] = useState("");
  /**
   * 开通流程里上一页被 replace 掉了，返回就是回首页；从安全中心进来则回安全中心。
   * 两边都用 goBack，不要写死 popToTop——那会把从安全中心进来的人甩回首页。
   */
  const leave = () =>
    navigation.canGoBack() ? navigation.goBack() : navigation.popToTop();
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  const tooShort = passphrase.length > 0 && !isPassphraseAcceptable(passphrase);
  const mismatch = confirm.length > 0 && confirm !== passphrase;
  const canSubmit =
    isPassphraseAcceptable(passphrase) && confirm === passphrase;

  const { run: enable, pending } = useAsyncAction(
    async () => {
      await wallet.enablePassphrase(passphrase, "wallet.passphrase.authReason");
      await queryClient.invalidateQueries({
        queryKey: ["wallet-passphrase-state"],
      });
      toast(t("wallet.passphrase.enabled"), "success");
      leave();
    },
    {
      failureMessage: t("wallet.passphrase.failed"),
      onError: () => {
        // 说清楚失败了，不要停在一个看起来成功的页面上——金库那边是原子的，
        // 失败就是没开，用户可以原样重试
        setError(t("wallet.passphrase.failed"));
      },
    },
  );

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={t("wallet.passphrase.title")}
          onBack={leave}
          backLabel={t("action.back")}
        />
      </Content>
      <PageScroll>
        <Content paddingTop="$1" gap="$4" paddingBottom={40}>
          <Stack gap="$1">
            <SectionTitle fontSize={18}>
              {t("wallet.passphrase.heading")}
            </SectionTitle>
            <Body>{t("wallet.passphrase.hint")}</Body>
          </Stack>
          <Row
            alignItems="flex-start"
            gap="$2"
            padding="$3"
            borderRadius="$4"
            style={{ backgroundColor: `${theme.warning.val}22` }}
          >
            <AppIcon name="alert-outline" size={18} colorToken="warning" />
            <Body flex={1} fontSize={12} color="$warning">
              {t("wallet.passphrase.warning")}
            </Body>
          </Row>
          <Stack gap="$2">
            <Body fontSize={12} color="$textMuted">
              {t("wallet.passphrase.label")}
            </Body>
            <TextField
              value={passphrase}
              onChangeText={(next) => {
                setPassphrase(next);
                setError("");
              }}
              placeholder={t("wallet.passphrase.placeholder")}
              accessibilityLabel={t("wallet.passphrase.label")}
              testID="wallet-passphrase-input"
              error={tooShort ? t("wallet.passphrase.tooShort") : undefined}
              // 口令不能进系统自动填充库、拼写词典和键盘学习记录（安全评审 N15）
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              importantForAutofill="no"
              textContentType="none"
              spellCheck={false}
            />
          </Stack>
          <Stack gap="$2">
            <Body fontSize={12} color="$textMuted">
              {t("wallet.passphrase.confirmLabel")}
            </Body>
            <TextField
              value={confirm}
              onChangeText={(next) => {
                setConfirm(next);
                setError("");
              }}
              placeholder={t("wallet.passphrase.placeholder")}
              accessibilityLabel={t("wallet.passphrase.confirmLabel")}
              testID="wallet-passphrase-confirm"
              error={
                mismatch
                  ? t("wallet.passphrase.mismatch")
                  : (error ?? undefined) || undefined
              }
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              importantForAutofill="no"
              textContentType="none"
              spellCheck={false}
            />
          </Stack>
          {/*
            口令派生是**故意很慢**的：模拟器上一次要以秒计。没有这个进行中的文案，
            用户看到的就是"按了没反应"的一个灰按钮——实测里我自己先被它骗了一轮。
          */}
          <PrimaryButton
            disabled={!canSubmit || pending}
            onPress={() => void enable()}
            testID="wallet-passphrase-submit"
          >
            {pending
              ? t("wallet.passphrase.enabling")
              : t("wallet.passphrase.submit")}
          </PrimaryButton>
          <Body
            textAlign="center"
            color="$textMuted"
            fontSize={13}
            accessibilityRole="button"
            testID="wallet-passphrase-skip"
            onPress={leave}
          >
            {t("wallet.passphrase.skip")}
          </Body>
        </Content>
      </PageScroll>
    </Page>
  );
}
