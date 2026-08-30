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

export type ModuleOverviewKind =
  "predict" | "positions" | "dex" | "market" | "swap";

const tokens = [
  { symbol: "PEPE", chain: "BSC", price: "$0.00001234", change: 12.4 },
  { symbol: "WIF", chain: "Solana", price: "$1.842", change: -3.8 },
  { symbol: "AERO", chain: "Base", price: "$0.912", change: 5.1 },
  { symbol: "BONK", chain: "Solana", price: "$0.00002611", change: 9.7 },
];

export function ModuleOverviewScreen({ kind }: { kind: ModuleOverviewKind }) {
  if (kind === "predict") return <PredictMarkets />;
  if (kind === "positions") return <PredictPositions />;
  if (kind === "swap") return <SwapScreen />;
  return <DexMarkets kind={kind} />;
}

function PredictMarkets() {
  const insets = useSafeAreaInsets();
  const { t } = useFoundationRuntime();
  return (
    <Page>
      <PageScroll>
        <Content paddingTop={insets.top + 24} gap="$3">
          <AppHeader title={t("module.predict.title")} />
          <Row gap="$2" flexWrap="wrap">
            {["热门", "突发", "新上线", "加密", "体育"].map((item, index) => (
              <Badge
                key={item}
                backgroundColor={index === 0 ? "$color" : "$surfaceVariant"}
              >
                <InlineText color={index === 0 ? "$background" : "$textMuted"}>
                  {item}
                </InlineText>
              </Badge>
            ))}
          </Row>
          <PredictionCard
            category="专场 · 世界杯"
            title="2026 世界杯冠军"
            meta="32 个结果 · 成交 $3.4M"
          />
          <PredictionCard
            category="加密 · 1 天后截止"
            title="BTC 8 月 31 日收盘价高于 $120,000？"
            meta="成交 $1.2M · 1,284 人持仓"
          />
          <PredictionCard
            category="财经 · 9 月 18 日截止"
            title="美联储 9 月 FOMC 降息幅度？"
            meta="成交 $860K"
          />
        </Content>
      </PageScroll>
    </Page>
  );
}

function PredictionCard({
  category,
  title,
  meta,
}: {
  category: string;
  title: string;
  meta: string;
}) {
  return (
    <Card shadowOpacity={0}>
      <Row justifyContent="space-between">
        <Label>{category}</Label>
        <Body fontSize={12}>{meta}</Body>
      </Row>
      <SectionTitle>{title}</SectionTitle>
      <Row gap="$2">
        <Badge flex={1} justifyContent="center" borderWidth={0}>
          <InlineText color="$success" fontWeight="800">
            买 Yes · 62¢
          </InlineText>
        </Badge>
        <Badge flex={1} justifyContent="center" borderWidth={0}>
          <InlineText color="$danger" fontWeight="800">
            买 No · 38¢
          </InlineText>
        </Badge>
      </Row>
    </Card>
  );
}

function PredictPositions() {
  const insets = useSafeAreaInsets();
  const { t } = useFoundationRuntime();
  return (
    <Page>
      <PageScroll>
        <Content paddingTop={insets.top + 24}>
          <AppHeader
            title={t("module.positions.title")}
            subtitle={t("module.positions.description")}
          />
          {["可领取", "争议中", "交易中"].map((status, index) => (
            <HairlineCard key={status}>
              <Row justifyContent="space-between">
                <Badge>
                  <InlineText
                    color={
                      index === 0
                        ? "$success"
                        : index === 1
                          ? "$warning"
                          : "$info"
                    }
                  >
                    {status}
                  </InlineText>
                </Badge>
                <Body>$2,340.12</Body>
              </Row>
              <SectionTitle>BTC 本周收盘高于 $120,000？</SectionTitle>
              <Row justifyContent="space-between">
                <Body>Yes · 161.3 份</Body>
                <InlineText color="$success" fontWeight="800">
                  +$61.30
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
              <InlineText color="$background">全部链</InlineText>
            </Badge>
            <Badge>
              <InlineText>BSC</InlineText>
            </Badge>
            <Badge>
              <InlineText>Ethereum</InlineText>
            </Badge>
          </Row>
          <Row gap="$4" paddingVertical="$2">
            <SectionTitle>热门</SectionTitle>
            <Body>涨幅榜</Body>
            <Body>新币</Body>
            <Body>自选</Body>
          </Row>
          {tokens.map((token) => (
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
                <Body fontSize={12}>{token.chain} · 流动性 $4.2M</Body>
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
        <Content paddingTop={insets.top + 24}>
          <AppHeader title={t("module.swap.title")} />
          <Card padding="$3" shadowOpacity={0}>
            <Stack
              backgroundColor="$surfaceVariant"
              borderRadius="$5"
              padding="$4"
              gap="$2"
            >
              <Row justifyContent="space-between">
                <Body>支付</Body>
                <Body>余额 0.842 BNB</Body>
              </Row>
              <Row justifyContent="space-between" alignItems="center">
                <AmountText>0.5</AmountText>
                <Badge>
                  <SectionTitle>BNB</SectionTitle>
                </Badge>
              </Row>
              <Body>≈ $312.40</Body>
            </Stack>
            <InlineText textAlign="center" fontSize={24}>
              ↓
            </InlineText>
            <Stack
              backgroundColor="$surfaceVariant"
              borderRadius="$5"
              padding="$4"
              gap="$2"
            >
              <Row justifyContent="space-between">
                <Body>获得（预估）</Body>
                <Body>余额 0 PEPE</Body>
              </Row>
              <Row justifyContent="space-between" alignItems="center">
                <AmountText>8,120,340</AmountText>
                <Badge>
                  <SectionTitle>PEPE</SectionTitle>
                </Badge>
              </Row>
              <Body>≈ $311.06</Body>
            </Stack>
          </Card>
          <HairlineCard>
            {[
              ["汇率", "1 BNB = 16,240,680 PEPE"],
              ["价格影响", "0.12%"],
              ["最少获得", "8,079,738 PEPE"],
              ["滑点", "0.5% · 自动"],
              ["网络费", "0.00012 BNB ≈ $0.08"],
              ["服务费", "0.10% · 已含"],
            ].map(([key, value]) => (
              <Row key={key} justifyContent="space-between">
                <Body>{key}</Body>
                <InlineText
                  color={key === "价格影响" ? "$success" : "$color"}
                  fontWeight="700"
                >
                  {value}
                </InlineText>
              </Row>
            ))}
          </HairlineCard>
          <PrimaryButton>{t("module.swap.title")}</PrimaryButton>
        </Content>
      </PageScroll>
    </Page>
  );
}
