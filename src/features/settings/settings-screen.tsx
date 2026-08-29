import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  Badge,
  Body,
  Card,
  Content,
  Divider,
  InlineText,
  Label,
  Page,
  PageScroll,
  PrimaryButton,
  Row,
  SecondaryButton,
  SegmentedControl,
  SectionTitle,
  ScreenHeader,
} from "../../design-system";
import { getCurrentUpdateMetadata } from "../../core/updates/update-service";
import type {
  LocalePreference,
  ThemePreference,
} from "../../core/preferences/preferences-store";
import type { RootStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "Settings">;

export function SettingsScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const {
    config,
    snapshot,
    t,
    localePreference,
    themePreference,
    setLocale,
    setTheme,
    notificationStatus,
    enableUpdateNotifications,
  } = useFoundationRuntime();
  const currentUpdate = getCurrentUpdateMetadata();
  const currentOtaRevision =
    currentUpdate.updateId &&
    currentUpdate.updateId === config.update.ota.updateId
      ? config.update.ota.revision
      : null;
  const themeOptions: { value: ThemePreference; label: string }[] = config.theme
    .allowUserOverride
    ? [
        { value: "system", label: t("theme.system") },
        { value: "light", label: t("theme.light") },
        { value: "dark", label: t("theme.dark") },
      ]
    : [{ value: "system", label: t("theme.system") }];
  const localeOptions: { value: LocalePreference; label: string }[] = [
    { value: "system", label: t("theme.system") },
    ...config.localization.supportedLocales.map((code) => ({
      value: code,
      label: code,
    })),
  ];
  return (
    <Page>
      <PageScroll>
        <Content paddingTop={insets.top + 20}>
          <ScreenHeader
            eyebrow="SETTINGS"
            title={t("settings.title")}
            subtitle={t("settings.subtitle")}
            onBack={() => navigation.goBack()}
            backLabel={t("action.back")}
          />
          <Card>
            <Label>{t("settings.appearance")}</Label>
            <SectionTitle>{t("settings.theme")}</SectionTitle>
            <SegmentedControl
              accessibilityLabel={t("settings.theme")}
              value={themePreference}
              options={themeOptions}
              onChange={setTheme}
            />
            {!config.theme.allowUserOverride ? (
              <Body>{t("settings.themeLocked")}</Body>
            ) : null}
            <Divider />
            <SectionTitle>{t("settings.language")}</SectionTitle>
            <SegmentedControl
              accessibilityLabel={t("settings.language")}
              value={localePreference}
              options={localeOptions}
              onChange={setLocale}
            />
          </Card>
          <Card>
            <Label>{t("settings.updates")}</Label>
            <SectionTitle>{t(`update.${config.update.decision}`)}</SectionTitle>
            <Body>
              {config.app.version}
              {config.update.decision !== "none"
                ? ` → ${config.update.latestVersion}`
                : ""}
            </Body>
            {config.features.updateCenter ? (
              <PrimaryButton
                onPress={() => navigation.navigate("UpdateCenter")}
              >
                {t("settings.openUpdateCenter")}
              </PrimaryButton>
            ) : null}
            <Divider />
            <SectionTitle>{t("settings.enableNotifications")}</SectionTitle>
            <SecondaryButton onPress={() => void enableUpdateNotifications()}>
              {notificationStatus === "registered"
                ? t("settings.notificationsEnabled")
                : t("settings.enableNotifications")}
            </SecondaryButton>
            {notificationStatus === "denied" ? (
              <Body>{t("settings.notificationsDenied")}</Body>
            ) : null}
          </Card>
          <Card>
            <Label>{t("settings.about")}</Label>
            <RowItem
              label={t("settings.version")}
              value={`${config.app.version} (${t("settings.installVersion")})`}
            />
            <RowItem
              label={t("settings.build")}
              value={config.app.buildNumber}
            />
            <RowItem
              label={t("settings.updateSource")}
              value={
                currentUpdate.isEmbedded
                  ? t("settings.embeddedBundle")
                  : t("settings.otaBundle")
              }
            />
          </Card>
          {config.features.diagnosticsEnabled ? (
            <Card>
              <Label>{t("settings.diagnostics")}</Label>
              <Body>{t("settings.diagnosticsHint")}</Body>
              <RowItem
                label={t("settings.service")}
                value={
                  snapshot.source === "remote"
                    ? t("status.connected")
                    : t("status.cached")
                }
              />
              <RowItem
                label={t("settings.runtime")}
                value={config.app.runtimeVersion}
              />
              <RowItem
                label={t("settings.configVersion")}
                value={config.configVersion}
              />
              <RowItem
                label={t("settings.languageVersion")}
                value={config.localization.messagesVersion}
              />
              {!currentUpdate.isEmbedded ? (
                <>
                  <RowItem
                    label={t("settings.otaRevision")}
                    value={
                      currentOtaRevision ? String(currentOtaRevision) : "-"
                    }
                  />
                  <RowItem
                    label={t("settings.otaUpdateId")}
                    value={currentUpdate.updateId ?? "-"}
                  />
                </>
              ) : null}
              <Badge>
                <InlineText color="$textMuted" fontSize={12}>
                  {config.support.diagnosticId}
                </InlineText>
              </Badge>
              <SecondaryButton
                onPress={() =>
                  void Linking.openURL(config.support.statusPageUrl)
                }
              >
                {t("settings.statusPage")}
              </SecondaryButton>
            </Card>
          ) : null}
        </Content>
      </PageScroll>
    </Page>
  );
}

function RowItem({ label, value }: { label: string; value: string }) {
  return (
    <Row justifyContent="space-between" alignItems="center" gap="$3">
      <Body>{label}</Body>
      <InlineText
        color="$color"
        fontWeight="700"
        textAlign="right"
        flexShrink={1}
      >
        {value}
      </InlineText>
    </Row>
  );
}
