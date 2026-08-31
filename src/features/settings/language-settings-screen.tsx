import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  Body,
  AppIcon,
  Card,
  Content,
  Page,
  PageScroll,
  Row,
  ScreenHeader,
  SectionTitle,
  Stack,
} from "../../design-system";
import type { LocalePreference } from "../../core/preferences/preferences-store";
import type { RootStackParamList } from "../../navigation/types";
import { LANGUAGE_NAMES } from "./language-names";

export function LanguageSettingsScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "LanguageSettings">) {
  const insets = useSafeAreaInsets();
  const { config, localePreference, setLocale, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const [pendingLocale, setPendingLocale] = useState<LocalePreference | null>(
    null,
  );
  const [switchError, setSwitchError] = useState(false);
  const switching = pendingLocale !== null;
  const languageCatalog =
    config.localization.localeCatalog ??
    config.localization.supportedLocales.map((code) => ({
      code,
      label: LANGUAGE_NAMES[code]?.native ?? code,
      nativeName:
        (locale === "zh-CN"
          ? LANGUAGE_NAMES[code]?.zh
          : LANGUAGE_NAMES[code]?.en) ?? code,
    }));
  const items: LocalePreference[] = [
    "system",
    ...languageCatalog.map((item) => item.code),
  ];
  return (
    <Page>
      <PageScroll>
        <Content paddingTop={insets.top + 16}>
          <ScreenHeader
            title={t("settings.language")}
            onBack={() => navigation.goBack()}
            backLabel={t("action.back")}
          />
          {switchError ? (
            <Card
              padding="$3"
              borderWidth={1}
              borderColor="$danger"
              backgroundColor="$surfaceVariant"
              accessibilityRole="alert"
            >
              <Body color="$danger">{t("status.error")}</Body>
              <Body color="$textMuted" fontSize={13}>
                {t("settings.languageSwitchRetry")}
              </Body>
            </Card>
          ) : null}
          <Card padding={0} gap={0} shadowOpacity={0}>
            {items.map((item, index) => {
              const language =
                item === "system"
                  ? undefined
                  : languageCatalog.find(
                      (candidate) => candidate.code === item,
                    );
              const label = language?.label ?? item;
              const secondary =
                language?.nativeName && language.nativeName !== label
                  ? language.nativeName
                  : undefined;
              return (
                <Row
                  key={item}
                  minHeight={58}
                  paddingHorizontal="$4"
                  alignItems="center"
                  borderBottomWidth={index === items.length - 1 ? 0 : 1}
                  borderColor="$borderColor"
                  disabled={switching}
                  opacity={switching && pendingLocale !== item ? 0.58 : 1}
                  onPress={() => {
                    setSwitchError(false);
                    setPendingLocale(item);
                    void setLocale(item)
                      .catch(() => setSwitchError(true))
                      .finally(() => setPendingLocale(null));
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={
                    item === "system" ? t("theme.system") : label
                  }
                  accessibilityState={{ selected: localePreference === item }}
                >
                  <SectionTitle flex={1} fontSize={15}>
                    {item === "system" ? t("theme.system") : label}
                  </SectionTitle>
                  {item === "system" ? (
                    <Body>{t("settings.followSystemLanguage")}</Body>
                  ) : secondary ? (
                    <Body>{secondary}</Body>
                  ) : null}
                  {pendingLocale === item ? (
                    <Body color="$textMuted" fontSize={12}>
                      …
                    </Body>
                  ) : null}
                  <Stack marginLeft="$3">
                    <AppIcon
                      name={
                        localePreference === item
                          ? "radiobox-marked"
                          : "radiobox-blank"
                      }
                      size={20}
                      colorToken={
                        localePreference === item ? "primary" : "textMuted"
                      }
                    />
                  </Stack>
                </Row>
              );
            })}
          </Card>
        </Content>
      </PageScroll>
    </Page>
  );
}
