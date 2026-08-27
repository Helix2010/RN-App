import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  AddressText,
  AmountText,
  AppHeader,
  Badge,
  Body,
  Card,
  Content,
  InlineText,
  Label,
  Page,
  PageScroll,
  PriceChange,
  PrimaryButton,
  Row,
  SecondaryButton,
  SectionTitle,
  Stack,
} from "../../design-system";
import type { RootStackParamList } from "../../navigation/types";

type Props = NativeStackScreenProps<RootStackParamList, "FoundationHome">;

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
          <AppHeader
            eyebrow={t("home.eyebrow")}
            title={t("home.title")}
            subtitle={t("home.description")}
            action={
              <SecondaryButton
                size="$3"
                paddingHorizontal="$3"
                onPress={() => navigation.navigate("Settings")}
                accessibilityLabel={t("action.settings")}
              >
                {t("action.settings")}
              </SecondaryButton>
            }
          />

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
                {t("settings.configVersion")} {config.configVersion} ·{" "}
                {config.localization.selectedLocale} ·{" "}
                {config.theme.paletteVersion}
              </InlineText>
            </Badge>
          </Row>

          <Card
            backgroundColor="$primary"
            borderColor="$primary"
            accessibilityLabel={t("home.portfolio")}
          >
            <Label color="$onPrimary">{t("home.portfolio")}</Label>
            <AmountText color="$onPrimary">¥ 128,640.00</AmountText>
            <InlineText color="$onPrimary" opacity={0.78} fontSize={12}>
              {t("home.portfolioChange")}
            </InlineText>
            <Row gap="$2">
              <PrimaryButton
                flex={1}
                backgroundColor="$onPrimary"
                color="$primary"
                onPress={() => navigation.navigate("Settings")}
              >
                {t("home.secondaryAction")}
              </PrimaryButton>
              {config.features.updateCenter ? (
                <SecondaryButton
                  flex={1}
                  backgroundColor="$primary"
                  color="$onPrimary"
                  borderColor="$onPrimary"
                  onPress={() => navigation.navigate("UpdateCenter")}
                >
                  {t("home.primaryAction")}
                </SecondaryButton>
              ) : null}
            </Row>
          </Card>

          <Card accessibilityLabel={t("home.market")}>
            <Row justifyContent="space-between" alignItems="flex-start">
              <Stack gap="$1">
                <Label>{t("home.market")}</Label>
                <SectionTitle>ETH / USDC</SectionTitle>
              </Stack>
              <Badge>
                <InlineText color="$info" fontWeight="700" fontSize={12}>
                  {t("home.network")}
                </InlineText>
              </Badge>
            </Row>
            <Row alignItems="baseline" gap="$3">
              <AmountText>$4,312.84</AmountText>
              <PriceChange value={2.14} />
            </Row>
            <AddressText numberOfLines={1}>
              0x71C7…F8A2 · {t("home.contract")}
            </AddressText>
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
            {config.features.updateCenter ? (
              <PrimaryButton
                onPress={() => navigation.navigate("UpdateCenter")}
              >
                {t("action.checkupdate")}
              </PrimaryButton>
            ) : null}
          </Card>

          <Card>
            <Label>{t("home.security")}</Label>
            <SectionTitle>{t("home.securityTitle")}</SectionTitle>
            <Body>{t("home.securityDescription")}</Body>
            <Row gap="$2" flexWrap="wrap">
              <Badge>
                <InlineText color="$success" fontSize={12} fontWeight="700">
                  {t("home.secureStorage")}
                </InlineText>
              </Badge>
              <Badge>
                <InlineText color="$info" fontSize={12} fontWeight="700">
                  {t("home.signedUpdates")}
                </InlineText>
              </Badge>
            </Row>
          </Card>
        </Content>
      </PageScroll>
    </Page>
  );
}
