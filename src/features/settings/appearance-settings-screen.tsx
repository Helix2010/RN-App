import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  Body,
  Card,
  Content,
  Label,
  Page,
  PageScroll,
  ScreenHeader,
  SegmentedControl,
  Stack,
} from "../../design-system";
import type { ThemePreference } from "../../core/preferences/preferences-store";
import type { RootStackParamList } from "../../navigation/types";

export function AppearanceSettingsScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "AppearanceSettings">) {
  const insets = useSafeAreaInsets();
  const { config, themePreference, setTheme, t } = useFoundationRuntime();
  const options: { value: ThemePreference; label: string }[] = config.theme
    .allowUserOverride
    ? [
        { value: "system", label: t("theme.system") },
        { value: "light", label: t("theme.light") },
        { value: "dark", label: t("theme.dark") },
      ]
    : [{ value: "system", label: t("theme.system") }];
  return (
    <Page>
      <PageScroll>
        <Content paddingTop={insets.top + 16}>
          <ScreenHeader
            title={t("settings.theme")}
            onBack={() => navigation.goBack()}
            backLabel={t("action.back")}
          />
          <Stack gap="$2">
            <Label>{t("settings.theme")}</Label>
            <Card shadowOpacity={0}>
              <SegmentedControl
                accessibilityLabel={t("settings.theme")}
                value={themePreference}
                options={options}
                onChange={setTheme}
              />
            </Card>
          </Stack>
          <Stack gap="$2">
            <Label>{t("settings.colorScheme")}</Label>
            <Card shadowOpacity={0}>
              <Body>{t("settings.greenUp")}</Body>
              <Body fontSize={12}>{t("settings.colorSchemeHint")}</Body>
            </Card>
          </Stack>
        </Content>
      </PageScroll>
    </Page>
  );
}
