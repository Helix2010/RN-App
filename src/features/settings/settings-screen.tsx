import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  Body,
  Card,
  Content,
  InlineText,
  Label,
  Page,
  PageScroll,
  Row,
  ScreenHeader,
  SectionTitle,
  Stack,
} from "../../design-system";
import type { RootStackParamList } from "../../navigation/types";

export function SettingsScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "Settings">) {
  const insets = useSafeAreaInsets();
  const { config, localePreference, themePreference, notificationStatus, t } =
    useFoundationRuntime();
  return (
    <Page>
      <PageScroll>
        <Content paddingTop={insets.top + 16} gap="$3">
          <ScreenHeader
            title={t("settings.title")}
            onBack={() => navigation.goBack()}
            backLabel={t("action.back")}
          />
          <SettingsGroup title={t("settings.section.general")}>
            <SettingsRow
              title={t("settings.language")}
              value={
                localePreference === "system"
                  ? t("theme.system")
                  : localePreference
              }
              onPress={() => navigation.navigate("LanguageSettings")}
            />
            <SettingsRow
              title={t("settings.theme")}
              value={t(`theme.${themePreference}`)}
              onPress={() => navigation.navigate("AppearanceSettings")}
            />
            <SettingsRow
              title={t("settings.colorScheme")}
              value={t("settings.greenUp")}
            />
            <SettingsRow
              title={t("settings.quoteCurrency")}
              value="USDT"
              last
            />
          </SettingsGroup>
          <SettingsGroup title={t("settings.section.notifications")}>
            <SettingsRow
              title={t("settings.notifications")}
              value={
                notificationStatus === "registered"
                  ? t("settings.notificationsEnabled")
                  : t("settings.notificationsOff")
              }
              last
            />
          </SettingsGroup>
          {config.modules.predict || config.modules.dex ? (
            <SettingsGroup title={t("settings.section.trading")}>
              {config.modules.predict ? (
                <>
                  <SettingsRow
                    title={t("settings.predictConfirm")}
                    value={t("settings.enabled")}
                  />
                  <SettingsRow
                    title={t("settings.predictOrderType")}
                    value={t("settings.marketOrder")}
                  />
                </>
              ) : null}
              {config.modules.dex ? (
                <>
                  <SettingsRow
                    title={t("settings.dexSlippage")}
                    value="0.5% · Auto"
                  />
                  <SettingsRow
                    title={t("settings.dexRiskWarning")}
                    value={t("settings.enabled")}
                    last
                  />
                </>
              ) : null}
            </SettingsGroup>
          ) : null}
          <SettingsGroup title={t("settings.section.security")}>
            <SettingsRow
              title={t("settings.securityCenter")}
              value={t("settings.securityHigh")}
              last
            />
          </SettingsGroup>
          <SettingsGroup title={t("settings.section.about")}>
            {config.features.updateCenter ? (
              <SettingsRow
                title={t("settings.checkUpdate")}
                value={
                  config.update.decision === "none"
                    ? t("update.none")
                    : config.update.latestVersion
                }
                onPress={() => navigation.navigate("UpdateCenter")}
              />
            ) : null}
            <SettingsRow title={t("settings.terms")} />
            <SettingsRow title={t("settings.privacy")} />
            <SettingsRow
              title={t("settings.clearCache")}
              value="28.4 MB"
              last
            />
          </SettingsGroup>
          <Stack alignItems="center" paddingVertical="$4" gap="$1">
            <Body fontSize={12}>
              {config.app.version} ({config.app.buildNumber}) ·{" "}
              {config.localization.selectedLocale}
            </Body>
            <InlineText
              color="$textMuted"
              fontSize={11}
              onPress={() => void Linking.openURL(config.support.statusPageUrl)}
            >
              {config.support.diagnosticId}
            </InlineText>
          </Stack>
        </Content>
      </PageScroll>
    </Page>
  );
}

function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Stack gap="$2">
      <Label paddingHorizontal="$2">{title}</Label>
      <Card padding={0} gap={0} shadowOpacity={0}>
        {children}
      </Card>
    </Stack>
  );
}

function SettingsRow({
  title,
  value,
  onPress,
  last = false,
}: {
  title: string;
  value?: string;
  onPress?: () => void;
  last?: boolean;
}) {
  return (
    <Row
      minHeight={54}
      paddingHorizontal="$4"
      alignItems="center"
      borderBottomWidth={last ? 0 : 1}
      borderColor="$borderColor"
      onPress={onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={title}
    >
      <SectionTitle flex={1} fontSize={15} fontWeight="500">
        {title}
      </SectionTitle>
      {value ? <Body fontSize={13}>{value}</Body> : null}
      {onPress ? (
        <InlineText color="$textMuted" fontSize={20} marginLeft="$2">
          ›
        </InlineText>
      ) : null}
    </Row>
  );
}
