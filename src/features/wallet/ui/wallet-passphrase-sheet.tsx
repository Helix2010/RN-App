import { useEffect, useRef, useState } from "react";
import { useFoundationRuntime } from "../../../app/runtime-context";
import {
  Body,
  PrimaryButton,
  Sheet,
  Stack,
  TextField,
  type SheetHandle,
} from "../../../design-system";
import { usePassphrasePrompt } from "../model/passphrase-prompt";

/**
 * 金库要口令时弹的那一层（安全评审 N6）。
 *
 * 全局挂一份，因为要口令的时机不属于任何一个页面：系统作废了认证绑定的密钥
 * （用户换了锁屏、重录了指纹），或者用户要查看助记词。
 *
 * 关掉 = 取消 = 交回 `null`。**取消不是口令错误**，金库据此抛
 * `WalletPassphraseRequiredError`，调用方才分得清"用户不想输"和"输错了"。
 */
export function WalletPassphraseSheet() {
  const { t } = useFoundationRuntime();
  const sheet = useRef<SheetHandle>(null);
  const open = usePassphrasePrompt((state) => state.open);
  const purpose = usePassphrasePrompt((state) => state.purpose);
  const retry = usePassphrasePrompt((state) => state.retry);
  const submitPassphrase = usePassphrasePrompt((state) => state.submit);
  const cancelPrompt = usePassphrasePrompt((state) => state.cancel);
  const [value, setValue] = useState("");

  // 输入框在这一层关掉时就清空，而不是下一次打开时清——组件不会卸载，
  // 留着等于把用户的口令一直挂在内存里等下一次
  const submit = () => {
    setValue("");
    submitPassphrase(value);
  };
  const cancel = () => {
    setValue("");
    cancelPrompt();
  };

  useEffect(() => {
    if (open) sheet.current?.present();
    else sheet.current?.dismiss();
  }, [open]);

  if (!open) return null;
  return (
    <Sheet
      ref={sheet}
      title={t("wallet.passphrase.unlockTitle")}
      closeLabel={t("common.close")}
      onDismiss={cancel}
      testID="wallet-passphrase-sheet"
    >
      <Stack gap="$3" paddingBottom="$3">
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
          secureTextEntry
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          importantForAutofill="no"
          textContentType="none"
          spellCheck={false}
        />
        <PrimaryButton
          disabled={value.length === 0}
          onPress={submit}
          testID="wallet-passphrase-sheet-submit"
        >
          {t("wallet.passphrase.unlock")}
        </PrimaryButton>
      </Stack>
    </Sheet>
  );
}
