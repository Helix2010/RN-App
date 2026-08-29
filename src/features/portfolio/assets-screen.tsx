import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
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

const assets = [
  {
    symbol: "ETH",
    network: "Ethereum",
    balance: "2.48 ETH",
    value: "$10,694.31",
    change: 3.2,
  },
  {
    symbol: "USDC",
    network: "Ethereum",
    balance: "8,420.00 USDC",
    value: "$8,420.00",
    change: 0.01,
  },
  {
    symbol: "BTC",
    network: "Bitcoin",
    balance: "0.072 BTC",
    value: "$7,914.20",
    change: -1.14,
  },
];

export function AssetsScreen({ onOpenUpdates }: { onOpenUpdates: () => void }) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
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
            <AmountText color="$onPrimary">$27,028.51</AmountText>
            <Row justifyContent="space-between" alignItems="center">
              <InlineText color="$onPrimary" opacity={0.78} fontSize={12}>
                {t("assets.today")}
              </InlineText>
              <InlineText color="$onPrimary" fontWeight="800">
                +$428.36 · +1.61%
              </InlineText>
            </Row>
          </Card>
          <Row gap="$3">
            <MetricCard label={t("assets.available")} value="$18,806.27" />
            <MetricCard label={t("assets.networks")} value="3" />
          </Row>
          <Stack gap="$3">
            <Row justifyContent="space-between" alignItems="center">
              <SectionTitle>{t("assets.holdings")}</SectionTitle>
              <Badge>
                <InlineText color="$textMuted" fontSize={11}>
                  {t("assets.updated")}
                </InlineText>
              </Badge>
            </Row>
            {assets.map((asset) => (
              <Card key={asset.symbol} padding="$3.5">
                <Row alignItems="center" gap="$3">
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
                  <Stack flex={1} gap="$1">
                    <SectionTitle>{asset.symbol}</SectionTitle>
                    <Body fontSize={12}>{asset.network}</Body>
                  </Stack>
                  <Stack alignItems="flex-end" gap="$1">
                    <SectionTitle>{asset.value}</SectionTitle>
                    <Row gap="$2" alignItems="center">
                      <InlineText color="$textMuted" fontSize={11}>
                        {asset.balance}
                      </InlineText>
                      <PriceChange value={asset.change} />
                    </Row>
                  </Stack>
                </Row>
              </Card>
            ))}
          </Stack>
          {config.features.updateCenter ? (
            <Card>
              <Label>{t("home.update")}</Label>
              <SectionTitle>
                {t(`update.${config.update.decision}`)}
              </SectionTitle>
              <Body>
                {config.app.version} → {config.update.latestVersion}
              </Body>
              <PrimaryButton onPress={onOpenUpdates}>
                {t("action.checkupdate")}
              </PrimaryButton>
            </Card>
          ) : null}
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
