import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  AmountText,
  Badge,
  Body,
  Card,
  Content,
  HairlineCard,
  HorizontalScroll,
  IconButton,
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
export function FoundationHomeScreen({
  onOpenAssets,
  onOpenProfile,
}: {
  onOpenAssets: () => void;
  onOpenProfile: () => void;
}) {
  const insets = useSafeAreaInsets();
  const runtime = useFoundationRuntime();
  const { config, t } = runtime;
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
          <Row alignItems="center" gap="$2">
            <IconButton
              label={t("profile.title")}
              symbol="K"
              size={32}
              onPress={onOpenProfile}
            />
            <Stack
              flex={1}
              height={42}
              borderRadius="$4"
              backgroundColor="$surfaceVariant"
              justifyContent="center"
              paddingHorizontal="$3"
            >
              <InlineText color="$textMuted" fontSize={13}>
                ⌕ {t("home.search")}
              </InlineText>
            </Stack>
            <IconButton label={t("home.scan")} symbol="⌗" size={32} />
            <IconButton label={t("home.support")} symbol="♧" size={32} />
            <IconButton label={t("home.notifications")} symbol="♢" size={32} />
          </Row>

          <Card
            backgroundColor="$surface"
            accessibilityLabel={t("home.portfolio")}
          >
            <Row justifyContent="space-between" alignItems="center">
              <Row alignItems="center" gap="$2">
                <Label>{t("home.portfolio")}</Label>
                <InlineText
                  color="$textMuted"
                  onPress={() => setBalanceVisible((visible) => !visible)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    balanceVisible
                      ? t("home.hideBalance")
                      : t("home.showBalance")
                  }
                >
                  {balanceVisible ? "◉" : "◎"}
                </InlineText>
              </Row>
              <Body fontSize={12}>USDT⌄</Body>
            </Row>
            <AmountText fontSize={30} lineHeight={36}>
              {balanceVisible ? "12,480.36" : "••••••"}
            </AmountText>
            <Row alignItems="center" gap="$2">
              <InlineText color="$textMuted" fontSize={12}>
                {t("home.portfolioApprox")}
              </InlineText>
              <InlineText color="$pricePositive" fontWeight="800">
                {t("home.portfolioToday")}
              </InlineText>
            </Row>
            <Row gap="$2" marginTop="$1">
              <PrimaryButton height={36} flex={1} onPress={onOpenAssets}>
                {t("home.deposit")}
              </PrimaryButton>
              <SecondaryButton height={36} flex={1}>
                {t("home.withdraw")}
              </SecondaryButton>
              <SecondaryButton height={36} flex={1}>
                {t("home.transfer")}
              </SecondaryButton>
            </Row>
          </Card>

          <Row flexWrap="wrap" gap="$3" paddingVertical="$2">
            <QuickAction
              label={t("home.quick.predict")}
              symbol="◒"
              enabled={config.modules.predict}
            />
            <QuickAction
              label={t("home.quick.swap")}
              symbol="⇄"
              enabled={config.modules.dex}
            />
            <QuickAction
              label={t("home.quick.rank")}
              symbol="♛"
              enabled={config.modules.predict}
            />
            <QuickAction label={t("home.quick.invite")} symbol="✦" enabled />
            <QuickAction label={t("home.quick.help")} symbol="?" enabled />
            <QuickAction label={t("home.quick.more")} symbol="▦" enabled />
          </Row>

          <Card
            backgroundColor="$surfaceVariant"
            paddingVertical="$2"
            paddingHorizontal="$3"
            shadowOpacity={0}
          >
            <Row alignItems="center" gap="$2">
              <InlineText color="$primary" fontSize={16}>
                ◖
              </InlineText>
              <Body flex={1} numberOfLines={1}>
                {t("home.notice")}
              </Body>
              <InlineText color="$textMuted" fontSize={20}>
                ›
              </InlineText>
            </Row>
          </Card>

          {config.modules.predict ? (
            <Stack gap="$2">
              <Row justifyContent="space-between" alignItems="center">
                <SectionTitle>{t("home.predict")}</SectionTitle>
                <InlineText color="$textMuted" fontSize={13}>
                  {t("home.viewAll")} ›
                </InlineText>
              </Row>
              <HorizontalScroll>
                <PredictionHomeCard
                  title={t("home.predictQuestion")}
                  closing={t("home.predictClosing")}
                />
                <PredictionHomeCard
                  title={t("home.predictFedQuestion")}
                  closing={t("home.predictFedClosing")}
                />
              </HorizontalScroll>
            </Stack>
          ) : null}
          {config.modules.dex ? (
            <Stack gap="$2">
              <Row justifyContent="space-between" alignItems="center">
                <SectionTitle>{t("home.dexHotTokens")}</SectionTitle>
                <InlineText color="$textMuted" fontSize={13}>
                  {t("home.market")} ›
                </InlineText>
              </Row>
              <TokenHomeRow
                symbol="PEPE"
                chain="BSC"
                price="$0.00001234"
                change={12.4}
              />
              <TokenHomeRow
                symbol="WIF"
                chain="Solana"
                price="$1.842"
                change={-3.8}
              />
              <TokenHomeRow
                symbol="AERO"
                chain="Base"
                price="$0.912"
                change={5.1}
              />
            </Stack>
          ) : null}

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

function QuickAction({
  label,
  symbol,
  enabled,
}: {
  label: string;
  symbol: string;
  enabled: boolean;
}) {
  if (!enabled) return null;
  return (
    <Stack width="22%" alignItems="center" gap="$1">
      <Stack
        width={44}
        height={44}
        borderRadius="$4"
        backgroundColor="$surfaceVariant"
        alignItems="center"
        justifyContent="center"
      >
        <InlineText color="$primary" fontSize={20}>
          {symbol}
        </InlineText>
      </Stack>
      <InlineText color="$textMuted" fontSize={12} numberOfLines={1}>
        {label}
      </InlineText>
    </Stack>
  );
}

function PredictionHomeCard({
  title,
  closing,
}: {
  title: string;
  closing: string;
}) {
  return (
    <Card width={236} padding="$3" shadowOpacity={0}>
      <Row justifyContent="space-between">
        <Badge>
          <InlineText color="$textMuted" fontSize={11}>
            加密
          </InlineText>
        </Badge>
        <Body fontSize={11}>成交 $1.2M</Body>
      </Row>
      <SectionTitle numberOfLines={2}>{title}</SectionTitle>
      <Body fontSize={12}>{closing}</Body>
      <Row gap="$2">
        <Badge flex={1} justifyContent="center" borderWidth={0}>
          <InlineText color="$success" fontWeight="800">
            Yes 62¢
          </InlineText>
        </Badge>
        <Badge flex={1} justifyContent="center" borderWidth={0}>
          <InlineText color="$danger" fontWeight="800">
            No 38¢
          </InlineText>
        </Badge>
      </Row>
    </Card>
  );
}

function TokenHomeRow({
  symbol,
  chain,
  price,
  change,
}: {
  symbol: string;
  chain: string;
  price: string;
  change: number;
}) {
  return (
    <Row
      alignItems="center"
      gap="$3"
      paddingVertical="$2"
      borderBottomWidth={1}
      borderColor="$borderColor"
    >
      <Stack
        width={36}
        height={36}
        borderRadius={999}
        backgroundColor="$surfaceVariant"
        alignItems="center"
        justifyContent="center"
      >
        <InlineText color="$primary" fontWeight="900">
          {symbol[0]}
        </InlineText>
      </Stack>
      <Stack flex={1}>
        <SectionTitle>{symbol}</SectionTitle>
        <Body fontSize={12}>{chain} · 流动性 $4.2M</Body>
      </Stack>
      <Stack alignItems="flex-end">
        <InlineText color="$color" fontWeight="700">
          {price}
        </InlineText>
        <PriceChange value={change} />
      </Stack>
    </Row>
  );
}
