import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import type {
  LocalePreference,
  ThemePreference,
} from "../../core/preferences/preferences-store";
import {
  AddressText,
  AmountText,
  Badge,
  Body,
  Card,
  Content,
  Heading,
  InlineText,
  Label,
  Page,
  PageScroll,
  PriceChange,
  PrimaryButton,
  Row,
  SectionTitle,
  SegmentedControl,
  Stack,
} from "../../design-system";
import type { RootStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "FoundationHome">;

function FlagRow({ label, value }: { label: string; value: boolean }) {
  return (
    <Row justifyContent="space-between" alignItems="center" gap="$3">
      <Body flex={1}>{label}</Body>
      <Badge backgroundColor={value ? "$surfaceVariant" : "$background"}>
        <InlineText
          color={value ? "$success" : "$textMuted"}
          fontWeight="700"
          fontSize={12}
        >
          {value ? "ON" : "OFF"}
        </InlineText>
      </Badge>
    </Row>
  );
}

export function FoundationHomeScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const runtime = useFoundationRuntime();
  const { config, snapshot, t } = runtime;
  const sourceLabel =
    snapshot.source === "remote"
      ? t("status.connected")
      : snapshot.source === "cache"
        ? t("status.cached")
        : t("status.error");

  const themeOptions: { value: ThemePreference; label: string }[] = [
    { value: "system", label: t("theme.system") },
    { value: "light", label: t("theme.light") },
    { value: "dark", label: t("theme.dark") },
  ];
  const localeOptions: { value: LocalePreference; label: string }[] = [
    { value: "system", label: t("theme.system") },
    ...config.localization.supportedLocales.map((code) => ({
      value: code,
      label: code,
    })),
  ];

  return (
    <Page>
      <PageScroll
        refresh={{
          refreshing: runtime.isRefreshing,
          onRefresh: () => void runtime.refresh(),
          accessibilityLabel: t("action.refresh"),
        }}
      >
        <Content paddingTop={insets.top + 24}>
          <Stack gap="$3" paddingBottom="$2">
            <Label color="$primary">{t("home.eyebrow")}</Label>
            <Heading>{t("home.title")}</Heading>
            <Body fontSize={16}>{t("home.description")}</Body>
            <Row gap="$2" flexWrap="wrap">
              <Badge>
                <InlineText
                  color={snapshot.source === "remote" ? "$success" : "$warning"}
                  fontSize={12}
                >
                  {sourceLabel}
                </InlineText>
              </Badge>
              <Badge>
                <InlineText color="$textMuted" fontSize={12}>
                  config {config.configVersion}
                </InlineText>
              </Badge>
            </Row>
          </Stack>

          <Card accessibilityLabel="Web3 design system reference">
            <Row justifyContent="space-between" alignItems="flex-start">
              <Stack gap="$1">
                <Label>Market reference</Label>
                <SectionTitle>ETH / USDC</SectionTitle>
              </Stack>
              <Badge>
                <InlineText color="$info" fontWeight="700" fontSize={12}>
                  Ethereum
                </InlineText>
              </Badge>
            </Row>
            <Row alignItems="baseline" gap="$3">
              <AmountText>$4,312.84</AmountText>
              <PriceChange value={2.14} />
            </Row>
            <AddressText numberOfLines={1}>
              0x71C7…F8A2 · wallet display contract
            </AddressText>
            <Body>
              金额使用等宽数字，涨跌色与风险色独立；地址使用等宽字体并保留首尾校验位。
            </Body>
          </Card>

          <Card>
            <Label>{t("home.theme")}</Label>
            <SegmentedControl
              accessibilityLabel={t("home.theme")}
              value={runtime.themePreference}
              options={themeOptions}
              onChange={runtime.setTheme}
            />
            <Body>palette · {config.theme.paletteVersion}</Body>
          </Card>

          <Card>
            <Label>{t("home.language")}</Label>
            <SegmentedControl
              accessibilityLabel={t("home.language")}
              value={runtime.localePreference}
              options={localeOptions}
              onChange={runtime.setLocale}
            />
            <Body>
              {config.localization.selectedLocale} · messages{" "}
              {config.localization.messagesVersion}
            </Body>
          </Card>

          <Card>
            <Row justifyContent="space-between" alignItems="center">
              <Stack flex={1} gap="$1">
                <Label>{t("home.update")}</Label>
                <SectionTitle>
                  {t(`update.${config.update.decision}`)}
                </SectionTitle>
              </Stack>
              <Badge>
                <InlineText color="$primary" fontWeight="700" fontSize={12}>
                  {config.app.version} → {config.update.latestVersion}
                </InlineText>
              </Badge>
            </Row>
            <Body>
              {config.app.platform} / {config.app.distribution} /{" "}
              {config.app.runtimeVersion}
            </Body>
            <PrimaryButton onPress={() => navigation.navigate("UpdateCenter")}>
              {t("action.checkUpdate")}
            </PrimaryButton>
          </Card>

          <Card>
            <Label>{t("home.features")}</Label>
            <FlagRow
              label="Update center"
              value={config.features.updateCenter}
            />
            <FlagRow label="OTA" value={config.features.otaEnabled} />
            <FlagRow
              label="Android direct"
              value={config.features.directUpdateEnabled}
            />
            <FlagRow
              label="Diagnostics"
              value={config.features.diagnosticsEnabled}
            />
          </Card>

          <Card>
            <Label>{t("home.remoteConfig")}</Label>
            <Body>request · {config.requestId}</Body>
            <Body>
              generated · {new Date(config.generatedAt).toLocaleString()}
            </Body>
            <PrimaryButton
              onPress={() => void runtime.refresh()}
              disabled={runtime.isRefreshing}
            >
              {t("action.refresh")}
            </PrimaryButton>
          </Card>
        </Content>
      </PageScroll>
    </Page>
  );
}
