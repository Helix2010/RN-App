import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  AmountText,
  AppHeader,
  Badge,
  Body,
  Card,
  Content,
  HairlineCard,
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
import type { RootStackParamList } from "../../navigation/types";
import {
  mockDexTokens,
  mockDexFilterChains,
  mockPredictMarkets,
  mockPredictPositions,
  mockSwapQuote,
  mockText,
} from "../demo-data";

export type ModuleOverviewKind =
  "predict" | "positions" | "dex" | "market" | "swap";

export function ModuleOverviewScreen({ kind }: { kind: ModuleOverviewKind }) {
  if (kind === "predict") return <PredictMarkets />;
  if (kind === "positions") return <PredictPositions />;
  if (kind === "swap") return <SwapScreen />;
  return <DexMarkets kind={kind} />;
}

function PredictMarkets() {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const locale = config.localization.selectedLocale;
  const filters = ["hot", "breaking", "new", "crypto", "sports"] as const;

  return (
    <Page>
      <PageScroll>
        <Content paddingTop={insets.top + 24} gap="$3">
          <AppHeader title={t("module.predict.title")} />
          <Row gap="$2" flexWrap="wrap">
            {filters.map((filter, index) => (
              <Badge
                key={filter}
                backgroundColor={index === 0 ? "$color" : "$surfaceVariant"}
              >
                <InlineText color={index === 0 ? "$background" : "$textMuted"}>
                  {t(`module.predict.filter.${filter}`)}
                </InlineText>
              </Badge>
            ))}
          </Row>
          {mockPredictMarkets.map((market) => (
            <PredictionCard
              key={market.title["en-US"]}
              category={mockText(market.category, locale)}
              title={mockText(market.title, locale)}
              meta={mockText(market.meta, locale)}
              yesPrice={market.yesPrice}
              noPrice={market.noPrice}
              yesLabel={market.yesLabel}
              noLabel={market.noLabel}
              onPress={() => navigation.navigate("PredictEvent")}
            />
          ))}
        </Content>
      </PageScroll>
    </Page>
  );
}

function PredictionCard({
  category,
  title,
  meta,
  yesPrice,
  noPrice,
  yesLabel,
  noLabel,
  onPress,
}: {
  category: string;
  title: string;
  meta: string;
  yesPrice: string;
  noPrice: string;
  yesLabel: string;
  noLabel: string;
  onPress: () => void;
}) {
  const { t } = useFoundationRuntime();
  return (
    <Card shadowOpacity={0} onPress={onPress} accessibilityRole="button">
      <Row justifyContent="space-between">
        <Label>{category}</Label>
        <Body fontSize={12}>{meta}</Body>
      </Row>
      <SectionTitle>{title}</SectionTitle>
      <Row gap="$2">
        <Badge flex={1} justifyContent="center" borderWidth={0}>
          <InlineText color="$success" fontWeight="800">
            {t("module.predict.buy")} {yesLabel} · {yesPrice}
          </InlineText>
        </Badge>
        <Badge flex={1} justifyContent="center" borderWidth={0}>
          <InlineText color="$danger" fontWeight="800">
            {t("module.predict.buy")} {noLabel} · {noPrice}
          </InlineText>
        </Badge>
      </Row>
    </Card>
  );
}

function PredictPositions() {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  return (
    <Page>
      <PageScroll>
        <Content paddingTop={insets.top + 24} gap="$3">
          <AppHeader
            title={t("module.positions.title")}
            subtitle={t("module.positions.description")}
          />
          {mockPredictPositions.map((position) => (
            <HairlineCard key={position.question["en-US"]}>
              <Row justifyContent="space-between">
                <Badge>
                  <InlineText
                    color={
                      position.status === "claimable"
                        ? "$success"
                        : position.status === "disputed"
                          ? "$warning"
                          : "$info"
                    }
                  >
                    {t(`module.positions.status.${position.status}`)}
                  </InlineText>
                </Badge>
                <Body>{position.value}</Body>
              </Row>
              <SectionTitle>{mockText(position.question, locale)}</SectionTitle>
              <Row justifyContent="space-between">
                <Body>
                  {position.side} · {position.shares}{" "}
                  {t("module.positions.shares")}
                </Body>
                <InlineText
                  color={position.pnl.startsWith("+") ? "$success" : "$danger"}
                  fontWeight="800"
                >
                  {position.pnl}
                </InlineText>
              </Row>
            </HairlineCard>
          ))}
        </Content>
      </PageScroll>
    </Page>
  );
}

function DexMarkets({ kind }: { kind: "dex" | "market" }) {
  const insets = useSafeAreaInsets();
  const { t } = useFoundationRuntime();
  return (
    <Page>
      <PageScroll>
        <Content paddingTop={insets.top + 24} gap="$2">
          <AppHeader title={t(`module.${kind}.title`)} />
          <Row gap="$2">
            <Badge backgroundColor="$color">
              <InlineText color="$background">
                {t("module.dex.filter.allChains")}
              </InlineText>
            </Badge>
            {mockDexFilterChains.map((chain) => (
              <Badge key={chain}>
                <InlineText>{chain}</InlineText>
              </Badge>
            ))}
          </Row>
          <Row gap="$4" paddingVertical="$2">
            <SectionTitle>{t("module.dex.tab.hot")}</SectionTitle>
            <Body>{t("module.dex.tab.gainers")}</Body>
            <Body>{t("module.dex.tab.new")}</Body>
            <Body>{t("module.dex.tab.watchlist")}</Body>
          </Row>
          {mockDexTokens.map((token) => (
            <Row
              key={token.symbol}
              paddingVertical="$3"
              borderBottomWidth={1}
              borderColor="$borderColor"
              alignItems="center"
              gap="$3"
            >
              <Stack
                width={42}
                height={42}
                borderRadius={999}
                backgroundColor="$surfaceVariant"
                alignItems="center"
                justifyContent="center"
              >
                <InlineText color="$primary" fontWeight="900">
                  {token.symbol[0]}
                </InlineText>
              </Stack>
              <Stack flex={1}>
                <SectionTitle>{token.symbol}</SectionTitle>
                <Body fontSize={12}>
                  {token.chain} · {t("module.dex.liquidity")} {token.liquidity}
                </Body>
              </Stack>
              <Stack alignItems="flex-end">
                <SectionTitle>{token.price}</SectionTitle>
                <PriceChange value={token.change} />
              </Stack>
            </Row>
          ))}
        </Content>
      </PageScroll>
    </Page>
  );
}

function SwapScreen() {
  const insets = useSafeAreaInsets();
  const { t } = useFoundationRuntime();
  return (
    <Page>
      <PageScroll>
        <Content paddingTop={insets.top + 24} gap="$3">
          <AppHeader title={t("module.swap.title")} />
          <Card padding="$3" shadowOpacity={0}>
            <SwapTokenPanel
              label={t("module.swap.pay")}
              {...mockSwapQuote.pay}
            />
            <InlineText textAlign="center" fontSize={24}>
              ↓
            </InlineText>
            <SwapTokenPanel
              label={t("module.swap.receiveEstimated")}
              {...mockSwapQuote.receive}
            />
          </Card>
          <HairlineCard>
            {mockSwapQuote.details.map((detail) => (
              <Row key={detail.key} justifyContent="space-between">
                <Body>{t(`module.swap.detail.${detail.key}`)}</Body>
                <InlineText
                  color={detail.positive === true ? "$success" : "$color"}
                  fontWeight="700"
                >
                  {detail.value}
                </InlineText>
              </Row>
            ))}
          </HairlineCard>
          <PrimaryButton>{t("module.swap.submit")}</PrimaryButton>
        </Content>
      </PageScroll>
    </Page>
  );
}

function SwapTokenPanel({
  label,
  balance,
  amount,
  token,
  value,
}: {
  label: string;
  balance: string;
  amount: string;
  token: string;
  value: string;
}) {
  const { t } = useFoundationRuntime();
  return (
    <Stack
      backgroundColor="$surfaceVariant"
      borderRadius="$5"
      padding="$4"
      gap="$2"
    >
      <Row justifyContent="space-between">
        <Body>{label}</Body>
        <Body>
          {t("module.swap.balancePrefix")} {balance}
        </Body>
      </Row>
      <Row justifyContent="space-between" alignItems="center">
        <AmountText>{amount}</AmountText>
        <Badge>
          <SectionTitle>{token}</SectionTitle>
        </Badge>
      </Row>
      <Body>{value}</Body>
    </Stack>
  );
}
