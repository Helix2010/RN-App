import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  Body,
  AppIcon,
  type AppIconName,
  Card,
  Content,
  HairlineCard,
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
import { mockSecurity, mockSettings, mockText } from "../demo-data";
import { useEdgeBackGesture } from "../../navigation/edge-back-gesture";

export function SettingsScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "Settings">) {
  const insets = useSafeAreaInsets();
  const {
    config,
    snapshot,
    localePreference,
    themePreference,
    notificationStatus,
    t,
  } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const serviceState =
    snapshot.source === "remote" && !snapshot.stale
      ? t("status.connected")
      : t("status.cached");
  const edgeBack = useEdgeBackGesture(navigation.goBack);
  return (
    <Page {...edgeBack}>
      <PageScroll>
        <Content paddingTop={insets.top + 16} gap="$3">
          <ScreenHeader
            title={t("settings.title")}
            subtitle={t("settings.subtitle")}
            onBack={() => navigation.goBack()}
            backLabel={t("action.back")}
          />
          <Card backgroundColor="$surfaceVariant" shadowOpacity={0}>
            <Row justifyContent="space-between" alignItems="center">
              <Stack gap="$1">
                <Label>{t("settings.about")}</Label>
                <SectionTitle>{config.app.version}</SectionTitle>
                <Body fontSize={12}>
                  {t("settings.build")} {config.app.buildNumber} ·{" "}
                  {serviceState}
                </Body>
              </Stack>
              <Stack alignItems="flex-end" gap="$1">
                <Body fontSize={11}>{t("settings.configversion")}</Body>
                <InlineText fontWeight="700">{config.configVersion}</InlineText>
              </Stack>
            </Row>
          </Card>
          <SettingsGroup title={t("settings.section.general")}>
            <SettingsRow
              icon="translate"
              title={t("settings.language")}
              value={
                localePreference === "system"
                  ? t("theme.system")
                  : localePreference
              }
              onPress={() => navigation.navigate("LanguageSettings")}
            />
            <SettingsRow
              icon="theme-light-dark"
              title={t("settings.theme")}
              value={t(`theme.${themePreference}`)}
              onPress={() => navigation.navigate("AppearanceSettings")}
            />
            <SettingsRow
              icon="format-color-fill"
              title={t("settings.colorScheme")}
              value={mockText(mockSettings.colorScheme, locale)}
            />
            <SettingsRow
              icon="cash-multiple"
              title={t("settings.quoteCurrency")}
              value={mockSettings.quoteCurrency}
              last
            />
          </SettingsGroup>
          <SettingsGroup title={t("settings.section.notifications")}>
            <SettingsRow
              icon="bell-outline"
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
                    icon="shield-check-outline"
                    title={t("settings.predictConfirm")}
                    value={t("settings.enabled")}
                  />
                  <SettingsRow
                    icon="chart-timeline-variant"
                    title={t("settings.predictOrderType")}
                    value={mockText(mockSettings.predictOrderType, locale)}
                  />
                </>
              ) : null}
              {config.modules.dex ? (
                <>
                  <SettingsRow
                    icon="swap-horizontal"
                    title={t("settings.dexSlippage")}
                    value={mockText(mockSettings.dexSlippage, locale)}
                  />
                  <SettingsRow
                    icon="alert-outline"
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
              icon="shield-lock-outline"
              title={t("settings.securityCenter")}
              value={t(`security.level.${mockSecurity.level}`)}
              last
            />
          </SettingsGroup>
          <SettingsGroup title={t("settings.section.about")}>
            {config.features.updateCenter ? (
              <SettingsRow
                icon="update"
                title={t("settings.checkUpdate")}
                value={
                  config.update.decision === "none"
                    ? t("update.none")
                    : config.update.latestVersion
                }
                onPress={() => navigation.navigate("UpdateCenter")}
              />
            ) : null}
            <SettingsRow
              icon="file-document-outline"
              title={t("settings.terms")}
            />
            <SettingsRow
              icon="shield-account-outline"
              title={t("settings.privacy")}
            />
            <SettingsRow
              icon="delete-outline"
              title={t("settings.clearCache")}
              value={mockSettings.cacheSize}
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
      <HairlineCard padding={0} gap={0} shadowOpacity={0}>
        {children}
      </HairlineCard>
    </Stack>
  );
}

function SettingsRow({
  icon = "circle-outline",
  title,
  value,
  onPress,
  last = false,
}: {
  icon?: AppIconName;
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
      <Stack
        width={32}
        height={32}
        borderRadius="$3"
        alignItems="center"
        justifyContent="center"
        backgroundColor="$surfaceVariant"
        marginRight="$3"
      >
        <AppIcon name={icon} size={15} />
      </Stack>
      <SectionTitle flex={1} fontSize={15} fontWeight="500">
        {title}
      </SectionTitle>
      {value ? <Body fontSize={13}>{value}</Body> : null}
      {onPress ? (
        <Stack marginLeft="$2">
          <AppIcon name="chevron-right" size={20} colorToken="textMuted" />
        </Stack>
      ) : null}
    </Row>
  );
}
