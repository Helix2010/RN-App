import { useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import { pickTranslation } from "../../core/i18n/localized-text";
import {
  formatCents,
  formatCompactNumber,
  formatMoney,
  formatTimeUntil,
  formatTokenPrice,
  formatUsd,
  shortenAddress,
} from "../../core/i18n/format";
import { mockNow } from "../../core/mock/mock-runtime";
import {
  AmountText,
  AppIcon,
  type AppIconName,
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
  type SheetHandle,
  SkeletonBlock,
  Sparkline,
  Stack,
} from "../../design-system";
import { useAssetsOverview } from "../assets/hooks/use-assets";
import { useDexTokens } from "../dex/hooks/use-dex";
import type { TokenSummary } from "../dex/model/dex";
import { usePredictEvents } from "../predict/hooks/use-predict";
import type { PredictEvent } from "../predict/model/predict";
import { useSession } from "../session/hooks/use-session";
import { requestAuth } from "../session/model/auth-sheet-store";
import { AccountSheet } from "../session/ui/account-sheet";

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

  const session = useSession();
  const accountSheet = useRef<SheetHandle>(null);
  const address = session.data?.address;
  const overview = useAssetsOverview(address, config.modules.predict);
  const events = usePredictEvents({ tagId: "hot", sort: "volume", limit: 4 });
  const tokens = useDexTokens({ sort: "hot", limit: 3 });

  const refreshing =
    runtime.isRefreshing ||
    overview.isRefetching ||
    events.isRefetching ||
    tokens.isRefetching;
  const refresh = () => {
    void runtime.refresh();
    void overview.refetch();
    void events.refetch();
    void tokens.refetch();
  };

  return (
    <Page>
      <PageScroll
        refresh={{
          refreshing,
          onRefresh: refresh,
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
            {address ? (
              <IconButton
                label={t("home.notifications")}
                icon="bell-outline"
                size={32}
              />
            ) : null}
          </Row>

          <Card
            backgroundColor="$surface"
            accessibilityLabel={t("home.portfolio")}
          >
            {address ? (
              <>
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
                        name={
                          balanceVisible ? "eye-outline" : "eye-off-outline"
                        }
                        size={18}
                        colorToken="textMuted"
                      />
                    </Stack>
                  </Row>
                  <Row
                    alignItems="center"
                    gap="$1"
                    onPress={() => accountSheet.current?.present()}
                    accessibilityRole="button"
                    accessibilityLabel={t("account.title")}
                    testID="home-account"
                  >
                    <Body fontSize={12}>
                      {session.data?.ens ?? shortenAddress(address)}
                    </Body>
                    <AppIcon
                      name="chevron-down"
                      size={15}
                      colorToken="textMuted"
                    />
                  </Row>
                </Row>
                {overview.data ? (
                  <>
                    <AmountText fontSize={30} lineHeight={36}>
                      {balanceVisible
                        ? formatUsd(overview.data.totalUsd, locale)
                        : "••••••"}
                    </AmountText>
                    <Row alignItems="center" gap="$2">
                      <InlineText color="$textMuted" fontSize={12}>
                        {t("home.walletAccount")}{" "}
                        {balanceVisible
                          ? formatUsd(overview.data.wallet.usd, locale)
                          : "••••"}
                        {overview.data.predict
                          ? ` · ${t("home.predictAccount")} ${balanceVisible ? formatUsd(overview.data.predict.usd, locale) : "••••"}`
                          : ""}
                      </InlineText>
                    </Row>
                    <Row alignItems="center" gap="$2">
                      <InlineText
                        color={
                          overview.data.change24hUsd >= 0
                            ? "$pricePositive"
                            : "$priceNegative"
                        }
                        fontWeight="800"
                      >
                        {balanceVisible
                          ? `${formatUsd(overview.data.change24hUsd, locale, { sign: true })} (${overview.data.change24hPct >= 0 ? "+" : ""}${overview.data.change24hPct.toFixed(2)}%)`
                          : "••••"}
                      </InlineText>
                      {overview.data.predict &&
                      BigInt(overview.data.predict.claimable.raw) > 0n ? (
                        <Badge
                          borderWidth={0}
                          backgroundColor="$surfaceVariant"
                          onPress={onOpenPredictPositions}
                        >
                          <InlineText
                            color="$success"
                            fontSize={11}
                            fontWeight="700"
                          >
                            {t("home.claimable")}{" "}
                            {formatMoney(
                              overview.data.predict.claimable,
                              locale,
                              { withSymbol: true },
                            )}
                          </InlineText>
                        </Badge>
                      ) : null}
                    </Row>
                  </>
                ) : overview.isError ? (
                  <InlineErrorRow
                    message={t("state.error")}
                    onRetry={() => void overview.refetch()}
                    retryLabel={t("action.retryNow")}
                  />
                ) : (
                  <Stack gap="$2">
                    <SkeletonBlock height={36} width={180} />
                    <SkeletonBlock height={14} width={240} />
                  </Stack>
                )}
                <Row gap="$2" marginTop="$1">
                  <PrimaryButton height={36} flex={1} onPress={onOpenAssets}>
                    {t("home.deposit")}
                  </PrimaryButton>
                  <SecondaryButton height={36} flex={1} onPress={onOpenAssets}>
                    {t("home.withdraw")}
                  </SecondaryButton>
                  <SecondaryButton height={36} flex={1} onPress={onOpenAssets}>
                    {t("home.transfer")}
                  </SecondaryButton>
                </Row>
              </>
            ) : (
              <>
                <Label>{t("login.welcome")}</Label>
                <SectionTitle>{t("login.welcomeTitle")}</SectionTitle>
                <Body>{t("login.welcomeHint")}</Body>
                <Row gap="$2" marginTop="$1">
                  <PrimaryButton
                    height={40}
                    flex={1}
                    disabled={session.isLoading}
                    onPress={() => requestAuth()}
                    testID="guest-connect"
                  >
                    {t("home.connectWallet")}
                  </PrimaryButton>
                  <SecondaryButton
                    height={40}
                    flex={1}
                    onPress={() => requestAuth()}
                    testID="guest-create"
                  >
                    {t("login.createWallet")}
                  </SecondaryButton>
                </Row>
              </>
            )}
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
              {events.data ? (
                events.data.items.length === 0 ? (
                  <Body>{t("state.empty")}</Body>
                ) : (
                  <HorizontalScroll>
                    {events.data.items.map((event) => (
                      <PredictionHomeCard
                        key={event.id}
                        event={event}
                        locale={locale}
                        volumeLabel={t("home.volume")}
                        closesLabel={t("home.closesIn")}
                        outcomesLabel={t("home.outcomes")}
                        onPress={onOpenPredict}
                      />
                    ))}
                  </HorizontalScroll>
                )
              ) : events.isError ? (
                <InlineErrorRow
                  message={t("state.error")}
                  onRetry={() => void events.refetch()}
                  retryLabel={t("action.retryNow")}
                />
              ) : (
                <HorizontalScroll>
                  <SkeletonBlock width={236} height={132} borderRadius="$4" />
                  <SkeletonBlock width={236} height={132} borderRadius="$4" />
                </HorizontalScroll>
              )}
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
              {tokens.data ? (
                tokens.data.items.length === 0 ? (
                  <Body>{t("state.empty")}</Body>
                ) : (
                  tokens.data.items.map((token) => (
                    <TokenHomeRow
                      key={`${token.token.chain}:${token.token.address}`}
                      summary={token}
                      locale={locale}
                      onPress={onOpenDex}
                    />
                  ))
                )
              ) : tokens.isError ? (
                <InlineErrorRow
                  message={t("state.error")}
                  onRetry={() => void tokens.refetch()}
                  retryLabel={t("action.retryNow")}
                />
              ) : (
                <Stack gap="$2">
                  <SkeletonBlock height={52} />
                  <SkeletonBlock height={52} />
                  <SkeletonBlock height={52} />
                </Stack>
              )}
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
      <AccountSheet ref={accountSheet} />
    </Page>
  );
}

function InlineErrorRow({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <Row
      alignItems="center"
      justifyContent="space-between"
      gap="$2"
      paddingVertical="$2"
    >
      <Body color="$danger" flex={1}>
        {message}
      </Body>
      <SecondaryButton height={32} paddingHorizontal="$3" onPress={onRetry}>
        {retryLabel}
      </SecondaryButton>
    </Row>
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
  event,
  locale,
  volumeLabel,
  closesLabel,
  outcomesLabel,
  onPress,
}: {
  event: PredictEvent;
  locale: string;
  volumeLabel: string;
  closesLabel: string;
  outcomesLabel: string;
  onPress: () => void;
}) {
  const primary = event.markets[0];
  const yes = primary?.yesPriceCents ?? 50;
  const multi = event.markets.length > 1;
  return (
    <Card
      width={236}
      padding="$3"
      shadowOpacity={0}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Row justifyContent="space-between">
        <Badge>
          <InlineText color="$textMuted" fontSize={11}>
            {multi
              ? outcomesLabel.replace("{n}", String(event.markets.length))
              : event.categoryTagId.toUpperCase()}
          </InlineText>
        </Badge>
        <Body fontSize={11}>
          {volumeLabel} {formatUsd(event.volumeUsd, locale, { compact: true })}
        </Body>
      </Row>
      <SectionTitle numberOfLines={2}>
        {pickTranslation(event.title, locale)}
      </SectionTitle>
      <Body fontSize={12}>
        {closesLabel} {formatTimeUntil(event.endsAt, mockNow(), locale)}
      </Body>
      {multi ? (
        <Stack gap="$1">
          {event.markets.slice(0, 2).map((market) => (
            <Row key={market.id} justifyContent="space-between">
              <Body fontSize={12} numberOfLines={1} flex={1}>
                {pickTranslation(market.outcomeLabel, locale)}
              </Body>
              <InlineText color="$color" fontWeight="800" fontSize={12}>
                {market.yesPriceCents}%
              </InlineText>
            </Row>
          ))}
        </Stack>
      ) : (
        <Row gap="$2">
          <Badge flex={1} justifyContent="center" borderWidth={0}>
            <InlineText color="$success" fontWeight="800">
              Yes {formatCents(yes)}
            </InlineText>
          </Badge>
          <Badge flex={1} justifyContent="center" borderWidth={0}>
            <InlineText color="$danger" fontWeight="800">
              No {formatCents(100 - yes)}
            </InlineText>
          </Badge>
        </Row>
      )}
    </Card>
  );
}

function TokenHomeRow({
  summary,
  locale,
  onPress,
}: {
  summary: TokenSummary;
  locale: string;
  onPress: () => void;
}) {
  const { t } = useFoundationRuntime();
  return (
    <Row
      alignItems="center"
      gap="$3"
      paddingVertical="$2"
      borderBottomWidth={1}
      borderColor="$borderColor"
      onPress={onPress}
      accessibilityRole="button"
    >
      <Stack
        width={36}
        height={36}
        borderRadius={999}
        alignItems="center"
        justifyContent="center"
        style={{ backgroundColor: summary.token.logoColor }}
      >
        <InlineText color="white" fontWeight="900">
          {summary.token.symbol[0]}
        </InlineText>
      </Stack>
      <Stack flex={1}>
        <SectionTitle>{summary.token.symbol}</SectionTitle>
        <Body fontSize={12}>
          {summary.token.chain.toUpperCase()} · {t("module.dex.liquidity")}{" "}
          {formatCompactNumber(summary.liquidityUsd, locale)}
        </Body>
      </Stack>
      <Sparkline
        values={summary.sparkline}
        tone={summary.change24hPct >= 0 ? "positive" : "negative"}
      />
      <Stack alignItems="flex-end" minWidth={92}>
        <InlineText color="$color" fontWeight="700">
          {formatTokenPrice(summary.priceUsd, locale)}
        </InlineText>
        <PriceChange value={summary.change24hPct} />
      </Stack>
    </Row>
  );
}
