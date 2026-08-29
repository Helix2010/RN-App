import { useState } from "react";
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
  HairlineCard,
  IconButton,
  InlineText,
  Label,
  Page,
  PageScroll,
  PriceChange,
  PrimaryButton,
  Row,
  SectionTitle,
  Stack,
} from "../../design-system";
export function FoundationHomeScreen({
  onOpenAssets,
  onOpenSettings,
}: {
  onOpenAssets: () => void;
  onOpenSettings: () => void;
}) {
  const insets = useSafeAreaInsets();
  const runtime = useFoundationRuntime();
  const { t } = runtime;
  const [balanceVisible, setBalanceVisible] = useState(true);

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
              <IconButton
                label={t("action.settings")}
                symbol="⚙"
                onPress={onOpenSettings}
              />
            }
          />

          <Card
            backgroundColor="$primary"
            borderColor="$primary"
            accessibilityLabel={t("home.portfolio")}
          >
            <Row justifyContent="space-between" alignItems="center">
              <Label color="$onPrimary">{t("home.portfolio")}</Label>
              <IconButton
                label={
                  balanceVisible ? t("home.hideBalance") : t("home.showBalance")
                }
                symbol={balanceVisible ? "◉" : "◎"}
                backgroundColor="$onPrimary"
                color="$primary"
                onPress={() => setBalanceVisible((visible) => !visible)}
              />
            </Row>
            <AmountText color="$onPrimary">
              {balanceVisible ? "¥ 128,640.00" : "¥ ••••••"}
            </AmountText>
            <Row justifyContent="space-between" alignItems="center">
              <InlineText color="$onPrimary" opacity={0.78} fontSize={12}>
                {t("home.portfolioChange")}
              </InlineText>
              <InlineText color="$onPrimary" fontWeight="800">
                +2.14%
              </InlineText>
            </Row>
            <Row gap="$2" marginTop="$1">
              <PrimaryButton
                flex={1}
                backgroundColor="$onPrimary"
                color="$primary"
                onPress={onOpenAssets}
              >
                {t("home.secondaryAction")}
              </PrimaryButton>
            </Row>
          </Card>

          <HairlineCard accessibilityLabel={t("home.market")}>
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
          </HairlineCard>

          <HairlineCard>
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
          </HairlineCard>
        </Content>
      </PageScroll>
    </Page>
  );
}
