import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Linking } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  AppHeader,
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
  SecondaryButton,
  SegmentedControl,
  SectionTitle,
  Stack,
} from "../../design-system";
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
  } = useFoundationRuntime();
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
          <SecondaryButton
            alignSelf="flex-start"
            onPress={() => navigation.goBack()}
          >
            {t("action.back")}
          </SecondaryButton>
          <AppHeader
            eyebrow="SETTINGS"
            title={t("settings.title")}
            subtitle={t("settings.subtitle")}
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
            <Stack gap="$2">
              <RowItem
                label={t("settings.updateCenter")}
                value={
                  config.features.updateCenter
                    ? t("settings.enabled")
                    : t("settings.disabled")
                }
              />
              <RowItem
                label={t("settings.ota")}
                value={
                  config.features.otaEnabled
                    ? t("settings.enabled")
                    : t("settings.disabled")
                }
              />
              <RowItem
                label={t("settings.distribution")}
                value={config.app.distribution}
              />
            </Stack>
            {config.features.updateCenter ? (
              <PrimaryButton
                onPress={() => navigation.navigate("UpdateCenter")}
              >
                {t("settings.openUpdateCenter")}
              </PrimaryButton>
            ) : null}
          </Card>
          <Card>
            <Label>{t("settings.about")}</Label>
            <RowItem label={t("settings.version")} value={config.app.version} />
            <RowItem
              label={t("settings.build")}
              value={config.app.buildNumber}
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
              label={t("settings.service")}
              value={
                snapshot.source === "remote"
                  ? t("status.connected")
                  : t("status.cached")
              }
            />
          </Card>
          {config.features.diagnosticsEnabled ? (
            <Card>
              <Label>{t("settings.diagnostics")}</Label>
              <Body>{t("settings.diagnosticsHint")}</Body>
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
    <Stack gap="$1">
      <Body>{label}</Body>
      <SectionTitle>{value}</SectionTitle>
    </Stack>
  );
}
