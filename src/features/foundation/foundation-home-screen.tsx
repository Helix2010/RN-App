import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  AmountText,
  AppIcon,
  type AppIconName,
  Badge,
  Body,
  Card,
  Content,
  SnapCarousel,
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
import { mockHomeData, mockText } from "../demo-data";
export function FoundationHomeScreen({
  onOpenAssets,
  onOpenProfile,
  onOpenPredict,
  onOpenPredictPositions,
  onOpenDex,
  onOpenSwap,
}: {
  onOpenAssets: () => void;
  onOpenProfile: () => void;
  onOpenPredict: () => void;
  onOpenPredictPositions: () => void;
  onOpenDex: () => void;
  onOpenSwap: () => void;
}) {
  const insets = useSafeAreaInsets();
  const runtime = useFoundationRuntime();
  const { config, t } = runtime;
  const locale = config.localization.selectedLocale;
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
              icon="account-circle-outline"
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
              <Row alignItems="center" gap="$2">
                <AppIcon name="magnify" size={17} colorToken="textMuted" />
                <InlineText color="$textMuted" fontSize={13}>
                  {t("home.search")}
                </InlineText>
              </Row>
            </Stack>
            <IconButton label={t("home.scan")} icon="line-scan" size={32} />
            <IconButton label={t("home.support")} icon="headset" size={32} />
            <IconButton
              label={t("home.notifications")}
              icon="bell-outline"
              size={32}
            />
          </Row>

          <Card
            backgroundColor="$surface"
            accessibilityLabel={t("home.portfolio")}
          >
            <Row justifyContent="space-between" alignItems="center">
              <Row alignItems="center" gap="$2">
                <Label>{t("home.portfolio")}</Label>
                <Stack
                  onPress={() => setBalanceVisible((visible) => !visible)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    balanceVisible
                      ? t("home.hideBalance")
                      : t("home.showBalance")
                  }
                >
                  <AppIcon
                    name={balanceVisible ? "eye-outline" : "eye-off-outline"}
                    size={18}
                    colorToken="textMuted"
                  />
                </Stack>
              </Row>
              <Row alignItems="center" gap="$1">
                <Body fontSize={12}>
                  {mockHomeData.portfolio.quoteCurrency}
                </Body>
                <AppIcon name="chevron-down" size={15} colorToken="textMuted" />
              </Row>
            </Row>
            <AmountText fontSize={30} lineHeight={36}>
              {balanceVisible ? mockHomeData.portfolio.balance : "••••••"}
            </AmountText>
            <Row alignItems="center" gap="$2">
              <InlineText color="$textMuted" fontSize={12}>
                {mockText(mockHomeData.portfolio.approx, locale)}
              </InlineText>
              <InlineText color="$pricePositive" fontWeight="800">
                {mockText(mockHomeData.portfolio.today, locale)}
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
              icon="chart-timeline-variant"
              enabled={config.modules.predict}
              onPress={onOpenPredict}
            />
            <QuickAction
              label={t("home.quick.swap")}
              icon="swap-horizontal"
              enabled={config.modules.dex}
              onPress={onOpenSwap}
            />
            <QuickAction
              label={t("home.quick.rank")}
              icon="trophy-outline"
              enabled={config.modules.predict}
              onPress={onOpenPredictPositions}
            />
            <QuickAction
              label={t("home.quick.invite")}
              icon="gift-outline"
              enabled
            />
            <QuickAction
              label={t("home.quick.help")}
              icon="help-circle-outline"
              enabled
            />
            <QuickAction
              label={t("home.quick.more")}
              icon="dots-grid"
              enabled
            />
          </Row>

          <Card
            backgroundColor="$surfaceVariant"
            paddingVertical="$2"
            paddingHorizontal="$3"
            shadowOpacity={0}
          >
            <Row alignItems="center" gap="$2">
              <AppIcon name="bullhorn-outline" size={17} />
              <Body flex={1} numberOfLines={1}>
                {mockText(mockHomeData.notice, locale)}
              </Body>
              <AppIcon name="chevron-right" size={20} colorToken="textMuted" />
            </Row>
          </Card>

          {config.modules.predict ? (
            <Stack gap="$2">
              <Row
                justifyContent="space-between"
                alignItems="center"
                onPress={onOpenPredict}
              >
                <SectionTitle>{t("home.predict")}</SectionTitle>
                <InlineText color="$textMuted" fontSize={13}>
                  {t("home.viewAll")} ›
                </InlineText>
              </Row>
              <SnapCarousel itemWidth={236} gap={12}>
                {mockHomeData.predictions.map((prediction) => (
                  <PredictionHomeCard
                    key={prediction.title["en-US"]}
                    category={mockText(prediction.category, locale)}
                    title={mockText(prediction.title, locale)}
                    closing={mockText(prediction.closing, locale)}
                    volume={mockText(prediction.volume, locale)}
                    yesLabel={prediction.yesLabel}
                    noLabel={prediction.noLabel}
                    yesPrice={prediction.yesPrice}
                    noPrice={prediction.noPrice}
                  />
                ))}
              </SnapCarousel>
            </Stack>
          ) : null}
          {config.modules.dex ? (
            <Stack gap="$2">
              <Row
                justifyContent="space-between"
                alignItems="center"
                onPress={onOpenDex}
              >
                <SectionTitle>{t("home.dexHotTokens")}</SectionTitle>
                <InlineText color="$textMuted" fontSize={13}>
                  {t("home.market")} ›
                </InlineText>
              </Row>
              {mockHomeData.dexTokens.map((token) => (
                <TokenHomeRow key={token.symbol} {...token} />
              ))}
            </Stack>
          ) : null}
        </Content>
      </PageScroll>
    </Page>
  );
}

function QuickAction({
  label,
  icon,
  enabled,
  onPress,
}: {
  label: string;
  icon: AppIconName;
  enabled: boolean;
  onPress?: () => void;
}) {
  if (!enabled) return null;
  return (
    <Stack
      width="22%"
      alignItems="center"
      gap="$1"
      onPress={onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={label}
    >
      <Stack
        width={44}
        height={44}
        borderRadius="$4"
        backgroundColor="$surfaceVariant"
        alignItems="center"
        justifyContent="center"
      >
        <AppIcon name={icon} size={22} />
      </Stack>
      <InlineText color="$textMuted" fontSize={12} numberOfLines={1}>
        {label}
      </InlineText>
    </Stack>
  );
}

function PredictionHomeCard({
  category,
  title,
  closing,
  volume,
  yesLabel,
  noLabel,
  yesPrice,
  noPrice,
}: {
  category: string;
  title: string;
  closing: string;
  volume: string;
  yesLabel: string;
  noLabel: string;
  yesPrice: string;
  noPrice: string;
}) {
  return (
    <Card width={236} padding="$3" shadowOpacity={0}>
      <Row justifyContent="space-between">
        <Badge>
          <InlineText color="$textMuted" fontSize={11}>
            {category}
          </InlineText>
        </Badge>
        <Body fontSize={11}>{volume}</Body>
      </Row>
      <SectionTitle numberOfLines={2}>{title}</SectionTitle>
      <Body fontSize={12}>{closing}</Body>
      <Row gap="$2">
        <Badge flex={1} justifyContent="center" borderWidth={0}>
          <InlineText color="$success" fontWeight="800">
            {yesLabel} {yesPrice}
          </InlineText>
        </Badge>
        <Badge flex={1} justifyContent="center" borderWidth={0}>
          <InlineText color="$danger" fontWeight="800">
            {noLabel} {noPrice}
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
  liquidity,
}: {
  symbol: string;
  chain: string;
  price: string;
  change: number;
  liquidity: string;
}) {
  const { t } = useFoundationRuntime();
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
        <Body fontSize={12}>
          {chain} · {t("module.dex.liquidity")} {liquidity}
        </Body>
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
