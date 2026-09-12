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
import {
  DEFAULT_MNEMONIC_WORDS,
  type MnemonicWordCount,
} from "../../../core/wallet/keygen/mnemonic";
import { recoveryReasonOf } from "../api/gateway";
import { stashPendingPhrase } from "../model/pending-reveal";

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
  // 默认 24 词（安全评审 N29）。给强的那个当默认，需要好抄的人自己降级——
  // 反过来等于让绝大多数人拿到较弱的那一个。
  const [words, setWords] = useState<MnemonicWordCount>(DEFAULT_MNEMONIC_WORDS);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const { mnemonic } = await wallet.createWallet({
        reason: "wallet.create.authReason",
        words,
      });
      void queryClient.invalidateQueries({ queryKey: ["wallet-accounts"] });
      // 助记词经模块级一次性通道交给备份页，不写进导航参数（安全评审 N36）
      stashPendingPhrase(mnemonic);
      navigation.replace("WalletBackup");
    } catch (error) {
      // 存储坏了时 vault 会拒绝写入：说清要先恢复，而不是"创建失败请重试"
      toast(
        recoveryReasonOf(error)
          ? t("wallet.recovery.blocked")
          : t("wallet.setup.failed"),
        "error",
      );
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
          <Stack gap="$2">
            <Body fontSize={12} color="$textMuted">
              {t("wallet.setup.words")}
            </Body>
            <Row gap="$2">
              {([24, 12] as const).map((count) => (
                <WordCountOption
                  key={count}
                  label={t(
                    count === 24
                      ? "wallet.setup.words24"
                      : "wallet.setup.words12",
                  )}
                  selected={words === count}
                  disabled={creating}
                  onPress={() => setWords(count)}
                  testID={`wallet-setup-words-${count}`}
                />
              ))}
            </Row>
          </Stack>
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

function WordCountOption({
  label,
  selected,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Row
      flex={1}
      alignItems="center"
      justifyContent="center"
      paddingVertical="$3"
      borderRadius="$4"
      borderWidth={1}
      borderColor={selected ? "$primary" : "$borderColor"}
      backgroundColor={selected ? "$surfaceVariant" : "transparent"}
      opacity={disabled ? 0.5 : 1}
      onPress={disabled ? undefined : onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      testID={testID}
    >
      <Body fontSize={13} color={selected ? "$primary" : "$textMuted"}>
        {label}
      </Body>
    </Row>
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
