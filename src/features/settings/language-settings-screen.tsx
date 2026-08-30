import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  Body,
  Card,
  Content,
  InlineText,
  Page,
  PageScroll,
  Row,
  ScreenHeader,
  SectionTitle,
} from "../../design-system";
import type { LocalePreference } from "../../core/preferences/preferences-store";
import type { RootStackParamList } from "../../navigation/types";

export function LanguageSettingsScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "LanguageSettings">) {
  const insets = useSafeAreaInsets();
  const { config, localePreference, setLocale, t } = useFoundationRuntime();
  const languageCatalog =
    config.localization.localeCatalog ??
    config.localization.supportedLocales.map((code) => ({
      code,
      label: code,
      nativeName: code,
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
                  onPress={() => setLocale(item)}
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
                  <InlineText
                    color={
                      localePreference === item ? "$primary" : "$textMuted"
                    }
                    fontSize={20}
                    marginLeft="$3"
                  >
                    {localePreference === item ? "◉" : "○"}
                  </InlineText>
                </Row>
              );
            })}
          </Card>
        </Content>
      </PageScroll>
    </Page>
  );
}
