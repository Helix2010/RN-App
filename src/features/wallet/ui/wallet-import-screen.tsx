import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { useGateways } from "../../../core/gateways/gateway-context";
import { useScreenProtect } from "../../../core/security/screen-protect";
import { shortenAddress } from "../../../core/i18n/format";
import {
  accountFromPrivateKey,
  deriveAccount,
  isValidMnemonic,
  isValidPrivateKey,
} from "../../../core/wallet/keygen/mnemonic";
import {
  AppIcon,
  ActionButton,
  Body,
  Content,
  Page,
  PageScroll,
  Row,
  ScreenHeader,
  SectionTitle,
  Stack,
  Tabs,
  TextField,
  toast,
  useTheme,
} from "../../../design-system";
import type { RootStackParamList } from "../../../navigation/types";

type Mode = "mnemonic" | "private-key";

/** L-05 导入钱包：助记词 或 私钥。校验通过才允许提交，并先显示将导入的地址。 */
export function WalletImportScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "WalletImport">) {
  const insets = useSafeAreaInsets();
  const { t } = useFoundationRuntime();
  const theme = useTheme();
  const { wallet } = useGateways();
  // 用户会在这里粘贴助记词 / 私钥，同样要挡住截图
  useScreenProtect("wallet-key-import");
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>("mnemonic");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  const preview = useMemo(() => {
    const trimmed = secret.trim();
    if (trimmed === "") return null;
    try {
      return mode === "mnemonic"
        ? isValidMnemonic(trimmed)
          ? deriveAccount(trimmed, 0).address
          : null
        : isValidPrivateKey(trimmed)
          ? accountFromPrivateKey(trimmed).address
          : null;
    } catch {
      return null;
    }
  }, [mode, secret]);

  /** 输入非空但解析不出地址时立即说明原因；否则按钮是禁用的，用户不知道哪里错了。 */
  const invalidHint =
    secret.trim() !== "" && !preview
      ? mode === "mnemonic"
        ? t("wallet.import.invalidMnemonic")
        : t("wallet.import.invalidPrivateKey")
      : "";

  const submit = async () => {
    const trimmed = secret.trim();
    if (!preview || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (mode === "mnemonic") await wallet.importMnemonic(trimmed);
      else await wallet.importPrivateKey(trimmed);
      setSecret("");
      void queryClient.invalidateQueries({ queryKey: ["wallet-accounts"] });
      toast(t("wallet.import.done"), "success");
      navigation.popToTop();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      setError(
        /already exists/i.test(message)
          ? t("wallet.import.duplicate")
          : mode === "mnemonic"
            ? t("wallet.import.invalidMnemonic")
            : t("wallet.import.invalidPrivateKey"),
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={t("wallet.import.title")}
          onBack={() => navigation.goBack()}
          backLabel={t("action.back")}
        />
      </Content>
      <PageScroll keyboardShouldPersistTaps="handled">
        <Content paddingTop="$1" gap="$4" paddingBottom={40}>
          <Tabs
            value={mode}
            onChange={(next) => {
              setMode(next);
              setSecret("");
              setError("");
            }}
            options={[
              { value: "mnemonic", label: t("wallet.import.tab.mnemonic") },
              {
                value: "private-key",
                label: t("wallet.import.tab.privateKey"),
              },
            ]}
            accessibilityLabel={t("wallet.import.title")}
          />
          <Row
            alignItems="center"
            gap="$2"
            padding="$3"
            borderRadius="$4"
            style={{ backgroundColor: `${theme.warning.val}22` }}
          >
            <AppIcon name="eye-off-outline" size={18} colorToken="warning" />
            <Body flex={1} fontSize={12} color="$warning">
              {t("wallet.import.warning")}
            </Body>
          </Row>
          <Stack gap="$2">
            <SectionTitle fontSize={14}>
              {mode === "mnemonic"
                ? t("wallet.import.tab.mnemonic")
                : t("wallet.import.tab.privateKey")}
            </SectionTitle>
            <TextField
              value={secret}
              onChangeText={(next) => {
                setSecret(next);
                setError("");
              }}
              placeholder={
                mode === "mnemonic"
                  ? t("wallet.import.mnemonicPlaceholder")
                  : t("wallet.import.privateKeyPlaceholder")
              }
              multiline={mode === "mnemonic"}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={mode === "private-key"}
              error={error || invalidHint || undefined}
              accessibilityLabel={
                mode === "mnemonic"
                  ? t("wallet.import.tab.mnemonic")
                  : t("wallet.import.tab.privateKey")
              }
              testID="wallet-import-secret"
            />
          </Stack>
          {preview ? (
            <Row
              alignItems="center"
              gap="$2"
              padding="$3"
              borderRadius="$4"
              backgroundColor="$surfaceVariant"
              testID="wallet-import-preview"
            >
              <AppIcon name="wallet-outline" size={18} colorToken="primary" />
              <Body flex={1} fontSize={12}>
                {t("wallet.import.derived")}
              </Body>
              <Body fontSize={12} fontWeight="700">
                {shortenAddress(preview)}
              </Body>
            </Row>
          ) : null}
          <ActionButton
            onPress={() => void submit()}
            disabled={busy || !preview}
            loading={busy}
            loadingLabel={t("common.processing")}
            width="100%"
            alignSelf="stretch"
            testID="wallet-import-submit"
          >
            {t("wallet.import.submit")}
          </ActionButton>
        </Content>
      </PageScroll>
    </Page>
  );
}
