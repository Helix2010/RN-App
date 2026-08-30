import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  AmountText,
  AppIcon,
  AppHeader,
  Badge,
  Body,
  Card,
  Content,
  HairlineCard,
  InlineText,
  Page,
  PageScroll,
  PriceChange,
  PrimaryButton,
  Row,
  SectionTitle,
  Stack,
} from "../../design-system";
import type { RootStackParamList } from "../../navigation/types";
import { MarketListScreen } from "../predict/ui/market-list-screen";
import { PositionsScreen } from "../predict/ui/positions-screen";
import {
  mockDexTokens,
  mockDexFilterChains,
  mockSwapQuote,
} from "../demo-data";

export type ModuleOverviewKind =
  "predict" | "positions" | "dex" | "market" | "swap";

export function ModuleOverviewScreen({ kind }: { kind: ModuleOverviewKind }) {
  if (kind === "predict") return <PredictMarketsTab />;
  if (kind === "positions") return <PredictPositionsTab />;
  if (kind === "swap") return <SwapScreen />;
  return <DexMarkets kind={kind} />;
}

function DexMarkets({ kind }: { kind: "dex" | "market" }) {
  const insets = useSafeAreaInsets();
  const { t } = useFoundationRuntime();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
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
              onPress={() => navigation.navigate("DexToken")}
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
            <Stack alignItems="center">
              <AppIcon name="swap-vertical" size={24} colorToken="textMuted" />
            </Stack>
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

function PredictMarketsTab() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { config } = useFoundationRuntime();
  return (
    <MarketListScreen
      showPositionsEntry={config.modules.dex}
      onOpenEvent={(event, market) =>
        navigation.navigate("PredictEvent", {
          eventId: event.id,
          marketId: market?.id,
        })
      }
      onOrder={(market, outcome) =>
        navigation.navigate("PredictEvent", {
          eventId: market.eventId,
          marketId: market.id,
          outcome,
        })
      }
      onOpenTransfer={() => navigation.navigate("Transfer")}
      onOpenPositions={() => navigation.navigate("Positions")}
      onOpenLeaderboard={() => navigation.navigate("Leaderboard")}
    />
  );
}

function PredictPositionsTab() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <PositionsScreen
      onOpenEvent={(eventId, marketId) =>
        navigation.navigate("PredictEvent", { eventId, marketId })
      }
      onOpenSettlement={(marketId) =>
        navigation.navigate("PredictSettlement", { marketId })
      }
      onOpenTransfer={() => navigation.navigate("Transfer")}
    />
  );
}
