import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  usePreferencesStore,
  type ColorSchemePreference,
  type ThemePreference,
} from "../../core/preferences/preferences-store";
import {
  Body,
  Content,
  InlineText,
  Label,
  Page,
  PageScroll,
  RadioRow,
  Row,
  ScreenHeader,
  Stack,
  useTheme,
} from "../../design-system";
import type { RootStackParamList } from "../../navigation/types";

/** S-04 外观：主题三选一（迷你屏幕预览）+ 涨跌颜色（只交换 up/down token，Yes/No 不跟随）。 */
export function AppearanceSettingsScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "AppearanceSettings">) {
  const insets = useSafeAreaInsets();
  const { config, themePreference, setTheme, t } = useFoundationRuntime();
  const colorScheme = usePreferencesStore((state) => state.colorScheme);
  const setColorScheme = usePreferencesStore((state) => state.setColorScheme);
  const themes: ThemePreference[] = config.theme.allowUserOverride
    ? ["system", "light", "dark"]
    : ["system"];
  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={t("appearance.title")}
          onBack={() => navigation.goBack()}
          backLabel={t("action.back")}
        />
      </Content>
      <PageScroll>
        <Content paddingTop="$1" gap="$4">
          <Stack gap="$2">
            <Label>{t("settings.theme")}</Label>
            <Row gap="$3">
              {themes.map((value) => (
                <ThemeOption
                  key={value}
                  value={value}
                  selected={themePreference === value}
                  label={t(`theme.${value}`)}
                  onPress={() => setTheme(value)}
                />
              ))}
            </Row>
            <Body fontSize={12}>{t("appearance.theme.hint")}</Body>
          </Stack>
          <Stack gap="$1">
            <Label>{t("settings.colorScheme")}</Label>
            {(["green-up", "red-up"] as ColorSchemePreference[]).map(
              (value) => (
                <RadioRow
                  key={value}
                  label={
                    value === "green-up"
                      ? t("appearance.colorScheme.greenUp")
                      : t("appearance.colorScheme.redUp")
                  }
                  selected={colorScheme === value}
                  onPress={() => setColorScheme(value)}
                  testID={
                    value === "green-up" ? "color-green-up" : "color-red-up"
                  }
                  trailing={
                    <Row gap="$2" marginRight="$2">
                      <InlineText
                        fontWeight="800"
                        color={value === "green-up" ? "#0E8A5F" : "#D03C45"}
                      >
                        ▲ +2.4%
                      </InlineText>
                      <InlineText
                        fontWeight="800"
                        color={value === "green-up" ? "#D03C45" : "#0E8A5F"}
                      >
                        ▼ −1.2%
                      </InlineText>
                    </Row>
                  }
                />
              ),
            )}
            <Body fontSize={12}>{t("appearance.colorScheme.hint")}</Body>
          </Stack>
        </Content>
      </PageScroll>
    </Page>
  );
}

function ThemeOption({
  value,
  selected,
  label,
  onPress,
}: {
  value: ThemePreference;
  selected: boolean;
  label: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  const light = { bg: "#F4F7FB", card: "#FFFFFF" };
  const dark = { bg: "#0B1220", card: "#1D2A3E" };
  const panel = (scheme: typeof light) => (
    <Stack flex={1} padding={6} gap={4} style={{ backgroundColor: scheme.bg }}>
      <Stack
        height={8}
        borderRadius={3}
        style={{ backgroundColor: scheme.card }}
      />
      <Stack
        height={16}
        borderRadius={3}
        style={{ backgroundColor: scheme.card }}
      />
      <Stack
        height={8}
        borderRadius={3}
        width="60%"
        style={{ backgroundColor: scheme.card }}
      />
    </Stack>
  );
  return (
    <Stack
      flex={1}
      alignItems="center"
      gap="$1.5"
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      testID={`theme-${value}`}
    >
      <Row
        width="100%"
        height={72}
        borderRadius="$3"
        overflow="hidden"
        borderWidth={2}
        style={{
          borderColor: selected ? theme.primary.val : theme.borderColor.val,
        }}
      >
        {value === "system" ? (
          <>
            {panel(light)}
            {panel(dark)}
          </>
        ) : value === "light" ? (
          panel(light)
        ) : (
          panel(dark)
        )}
      </Row>
      <InlineText
        fontSize={12}
        fontWeight={selected ? "800" : "600"}
        color={selected ? "$primary" : "$color"}
      >
        {label}
      </InlineText>
    </Stack>
  );
}
