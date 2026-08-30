import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  AmountText,
  AppHeader,
  Badge,
  Card,
  Content,
  InlineText,
  Label,
  ListRow,
  Page,
  PageScroll,
  PriceChange,
  Row,
  SectionTitle,
  Stack,
} from "../../design-system";
import { mockAssetData, mockText } from "../demo-data";

export function AssetsScreen() {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  return (
    <Page>
      <PageScroll>
        <Content paddingTop={insets.top + 24}>
          <AppHeader
            eyebrow={t("assets.eyebrow")}
            title={t("assets.title")}
            subtitle={t("assets.subtitle")}
          />
          <Card backgroundColor="$primary" borderColor="$primary">
            <Label color="$onPrimary">{t("assets.total")}</Label>
            <AmountText color="$onPrimary">{mockAssetData.total}</AmountText>
            <Row justifyContent="space-between" alignItems="center">
              <InlineText color="$onPrimary" opacity={0.78} fontSize={12}>
                {t("assets.today")}
              </InlineText>
              <InlineText color="$onPrimary" fontWeight="800">
                {mockAssetData.today}
              </InlineText>
            </Row>
          </Card>
          <Row gap="$3">
            <MetricCard
              label={t("assets.available")}
              value={mockAssetData.available}
            />
            <MetricCard
              label={t("assets.networks")}
              value={mockAssetData.networks}
            />
          </Row>
          <Stack gap="$2">
            <SectionTitle>{t("assets.accounts")}</SectionTitle>
            <AccountCard
              symbol={mockAssetData.accounts.funding.symbol}
              title={t("assets.fundingAccount")}
              value={mockAssetData.accounts.funding.value}
              subtitle={mockText(
                mockAssetData.accounts.funding.subtitle,
                locale,
              )}
            />
            {config.modules.predict ? (
              <AccountCard
                symbol={mockAssetData.accounts.predict.symbol}
                title={t("assets.predictAccount")}
                value={mockAssetData.accounts.predict.value}
                subtitle={mockText(
                  mockAssetData.accounts.predict.subtitle,
                  locale,
                )}
              />
            ) : null}
            {config.modules.dex ? (
              <AccountCard
                symbol={mockAssetData.accounts.dex.symbol}
                title={t("assets.dexWallet")}
                value={mockAssetData.accounts.dex.value}
                subtitle={mockText(mockAssetData.accounts.dex.subtitle, locale)}
              />
            ) : null}
          </Stack>
          <Stack gap="$3">
            <Row justifyContent="space-between" alignItems="center">
              <SectionTitle>{t("assets.holdings")}</SectionTitle>
              <Badge>
                <InlineText color="$textMuted" fontSize={11}>
                  {t("assets.updated")}
                </InlineText>
              </Badge>
            </Row>
            {mockAssetData.holdings.map((asset) => (
              <Card key={asset.symbol} padding="$2" shadowOpacity={0}>
                <ListRow
                  title={asset.symbol}
                  subtitle={`${asset.network} · ${asset.balance}`}
                  leading={
                    <Stack
                      width={44}
                      height={44}
                      borderRadius={999}
                      alignItems="center"
                      justifyContent="center"
                      backgroundColor="$surfaceVariant"
                    >
                      <InlineText color="$primary" fontWeight="900">
                        {asset.symbol.slice(0, 1)}
                      </InlineText>
                    </Stack>
                  }
                  trailing={
                    <Stack alignItems="flex-end" gap="$1">
                      <SectionTitle>{asset.value}</SectionTitle>
                      <PriceChange value={asset.change} />
                    </Stack>
                  }
                />
              </Card>
            ))}
          </Stack>
        </Content>
      </PageScroll>
    </Page>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card flex={1} padding="$3.5">
      <Label>{label}</Label>
      <SectionTitle>{value}</SectionTitle>
    </Card>
  );
}

function AccountCard({
  symbol,
  title,
  value,
  subtitle,
}: {
  symbol: string;
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <Card padding="$3" shadowOpacity={0}>
      <Row alignItems="center" gap="$3">
        <Stack
          width={42}
          height={42}
          borderRadius="$4"
          backgroundColor="$surfaceVariant"
          alignItems="center"
          justifyContent="center"
        >
          <InlineText color="$primary" fontSize={20}>
            {symbol}
          </InlineText>
        </Stack>
        <Stack flex={1}>
          <SectionTitle>{title}</SectionTitle>
          <InlineText color="$textMuted" fontSize={12}>
            {subtitle}
          </InlineText>
        </Stack>
        <Stack alignItems="flex-end">
          <SectionTitle>{value}</SectionTitle>
          <InlineText color="$textMuted" fontSize={18}>
            ›
          </InlineText>
        </Stack>
      </Row>
    </Card>
  );
}
