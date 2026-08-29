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
  SectionTitle,
  Stack,
} from "../../design-system";
export function FoundationHomeScreen({
  onOpenAssets,
}: {
  onOpenAssets: () => void;
}) {
  const insets = useSafeAreaInsets();
  const runtime = useFoundationRuntime();
  const { t } = runtime;

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
          />

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
                onPress={onOpenAssets}
              >
                {t("home.secondaryAction")}
              </PrimaryButton>
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
