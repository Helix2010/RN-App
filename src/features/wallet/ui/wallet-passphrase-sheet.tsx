import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform } from "react-native";
import { useFoundationRuntime } from "../../../app/runtime-context";
import {
  Body,
  Card,
  PrimaryButton,
  SecondaryButton,
  SectionTitle,
  Stack,
  TextField,
} from "../../../design-system";
import { usePassphrasePrompt } from "../model/passphrase-prompt";

/**
 * 金库要口令时弹的那一层（安全评审 N6）。
 *
 * 全局挂一份，因为要口令的时机不属于任何一个页面：系统作废了认证绑定的密钥
 * （用户换了锁屏、重录了指纹），或者用户要查看助记词。
 *
 * **用居中弹层而不是底部抽屉。** 抽屉那套的键盘避让接不住这个场景——模拟器上
 * 实测：抽屉停在原位，键盘把输入框和按钮整个盖住，用户看得见标题却按不到按钮。
 * 居中弹层配 KeyboardAvoidingView 就没有这个问题，而且它本来就该是阻断式的。
 *
 * 关掉 = 取消 = 交回 `null`。**取消不是口令错误**，金库据此抛
 * `WalletPassphraseRequiredError`，调用方才分得清"用户不想输"和"输错了"。
 */
export function WalletPassphraseSheet() {
  const { t } = useFoundationRuntime();
  const open = usePassphrasePrompt((state) => state.open);
  const purpose = usePassphrasePrompt((state) => state.purpose);
  const retry = usePassphrasePrompt((state) => state.retry);
  const submitPassphrase = usePassphrasePrompt((state) => state.submit);
  const cancelPrompt = usePassphrasePrompt((state) => state.cancel);
  const [value, setValue] = useState("");

  // 这一层关掉时就清空，而不是下一次打开时清——组件不会卸载，留着等于把口令
  // 一直挂在内存里等下一次
  const submit = () => {
    setValue("");
    submitPassphrase(value);
  };
  const cancel = () => {
    setValue("");
    cancelPrompt();
  };

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={cancel}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Stack
          flex={1}
          justifyContent="center"
          padding="$4"
          backgroundColor="rgba(0,0,0,0.55)"
        >
          <Card
            width="100%"
            maxWidth={460}
            alignSelf="center"
            padding="$5"
            testID="wallet-passphrase-sheet"
          >
            <Stack gap="$3">
              <SectionTitle fontSize={18}>
                {t("wallet.passphrase.unlockTitle")}
              </SectionTitle>
              <Body fontSize={13} color="$textMuted">
                {purpose === "reveal"
                  ? t("wallet.passphrase.revealHint")
                  : t("wallet.passphrase.unlockHint")}
              </Body>
              <TextField
                value={value}
                onChangeText={setValue}
                placeholder={t("wallet.passphrase.placeholder")}
                accessibilityLabel={t("wallet.passphrase.label")}
                testID="wallet-passphrase-sheet-input"
                error={retry ? t("wallet.passphrase.wrong") : undefined}
                // 口令不进系统自动填充库、拼写词典和键盘学习记录（安全评审 N15）
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
                textContentType="none"
                spellCheck={false}
                onSubmitEditing={() => value.length > 0 && submit()}
              />
              <PrimaryButton
                disabled={value.length === 0}
                onPress={submit}
                testID="wallet-passphrase-sheet-submit"
              >
                {t("wallet.passphrase.unlock")}
              </PrimaryButton>
              <SecondaryButton
                onPress={cancel}
                testID="wallet-passphrase-sheet-cancel"
              >
                {t("common.close")}
              </SecondaryButton>
            </Stack>
          </Card>
        </Stack>
      </KeyboardAvoidingView>
    </Modal>
  );
}
