import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { useGateways } from "../../../core/gateways/gateway-context";
import {
  AppIcon,
  Body,
  Content,
  Page,
  PageScroll,
  Row,
  ScreenHeader,
  SectionTitle,
  Stack,
  toast,
  useTheme,
  type AppIconName,
} from "../../../design-system";
import type { RootStackParamList } from "../../../navigation/types";

/**
 * 自托管钱包的入口：创建新钱包 或 导入已有钱包。
 * 创建成功后直接进备份流程 —— 助记词只在那一次可见，不备份就没有恢复途径。
 */
export function WalletSetupScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "WalletSetup">) {
  const insets = useSafeAreaInsets();
  const { t } = useFoundationRuntime();
  const theme = useTheme();
  const { wallet } = useGateways();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const { mnemonic } = await wallet.createWallet();
      void queryClient.invalidateQueries({ queryKey: ["wallet-accounts"] });
      navigation.replace("WalletBackup", { phrase: mnemonic });
    } catch {
      toast(t("wallet.setup.failed"), "error");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={t("wallet.setup.title")}
          onBack={() => navigation.goBack()}
          backLabel={t("action.back")}
        />
      </Content>
      <PageScroll>
        <Content paddingTop="$1" gap="$4" paddingBottom={40}>
          <Stack gap="$1">
            <SectionTitle fontSize={18}>
              {t("wallet.setup.heading")}
            </SectionTitle>
            <Body>{t("wallet.setup.hint")}</Body>
          </Stack>
          <Row
            alignItems="center"
            gap="$2"
            padding="$3"
            borderRadius="$4"
            style={{ backgroundColor: `${theme.warning.val}22` }}
          >
            <AppIcon name="shield-key-outline" size={18} colorToken="warning" />
            <Body flex={1} fontSize={12} color="$warning">
              {t("wallet.setup.custodyNotice")}
            </Body>
          </Row>
          <SetupOption
            icon="wallet-plus-outline"
            title={
              creating ? t("wallet.setup.creating") : t("wallet.setup.create")
            }
            hint={t("wallet.setup.createHint")}
            disabled={creating}
            onPress={() => void create()}
            testID="wallet-setup-create"
          />
          <SetupOption
            icon="import"
            title={t("wallet.setup.import")}
            hint={t("wallet.setup.importHint")}
            disabled={creating}
            onPress={() => navigation.navigate("WalletImport")}
            testID="wallet-setup-import"
          />
        </Content>
      </PageScroll>
    </Page>
  );
}

function SetupOption({
  icon,
  title,
  hint,
  disabled,
  onPress,
  testID,
}: {
  icon: AppIconName;
  title: string;
  hint: string;
  disabled?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Row
      alignItems="center"
      gap="$3"
      padding="$4"
      borderRadius="$4"
      backgroundColor="$surfaceVariant"
      opacity={disabled ? 0.5 : 1}
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      testID={testID}
    >
      <AppIcon name={icon} size={24} colorToken="primary" />
      <Stack flex={1} gap="$1">
        <SectionTitle fontSize={15}>{title}</SectionTitle>
        <Body fontSize={12} color="$textMuted">
          {hint}
        </Body>
      </Stack>
      <AppIcon name="chevron-right" size={20} colorToken="textMuted" />
    </Row>
  );
}
