import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { CHAINS, type ChainId } from "../../../core/gateways/types";
import { formatCompactNumber, shortenAddress } from "../../../core/i18n/format";
import {
  Body,
  Content,
  HorizontalScroll,
  InlineText,
  Page,
  PageScroll,
  PrimaryButton,
  Row,
  SectionTitle,
  SkeletonBlock,
  Sparkline,
  Stack,
  Switch,
  Tabs,
} from "../../../design-system";
import { useSession } from "../../session/hooks/use-session";
import { requestAuth } from "../../session/model/auth-sheet-store";
import { useDexTokens } from "../hooks/use-dex";
import type { TokenQuery, TokenSummary } from "../model/dex";
import { ChainDot, TokenAvatar, TokenPrice } from "./shared";

/** D-01 行情 / DEX 首页：链筛选、热门 / 涨幅榜 / 新币 / 自选、流动性过滤、代币行（名称+市值·流动性 / 走势 / 价格+24h）。 */
export function MarketScreen({
  onOpenToken,
  onOpenSwap,
  onOpenHistory,
}: {
  onOpenToken: (token: TokenSummary) => void;
  onOpenSwap: () => void;
  onOpenHistory: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const session = useSession();
  const address = session.data?.address;
  const [chain, setChain] = useState<ChainId | "all">("all");
  const [tab, setTab] = useState<"hot" | "gainers" | "new" | "watchlist">(
    "hot",
  );
  const [minLiquidity, setMinLiquidity] = useState(true);
  const query: TokenQuery = {
    chain: chain === "all" ? undefined : chain,
    sort: tab === "watchlist" ? "hot" : tab,
    minLiquidityUsd: minLiquidity ? 100_000 : undefined,
    limit: 30,
  };
  const tokens = useDexTokens(query);
  const [watchlist, setWatchlist] = useState<string[]>([
    "bsc:0x25d887ce7a35172c62fbfd1c0dab40dd66b0a4c1",
  ]);
  const rows =
    tab === "watchlist"
      ? (tokens.data?.items ?? []).filter((item) =>
          watchlist.includes(`${item.token.chain}:${item.token.address}`),
        )
      : (tokens.data?.items ?? []);

  return (
    <Page>
      <PageScroll
        refresh={{
          refreshing: tokens.isRefetching,
          onRefresh: () => void tokens.refetch(),
          accessibilityLabel: t("action.refresh"),
        }}
      >
        <Content paddingTop={insets.top + 16} gap="$3">
          <Row alignItems="center" justifyContent="space-between">
            <SectionTitle fontSize={20}>
              {config.modules.predict ? t("dex.title") : t("dex.marketTitle")}
            </SectionTitle>
            {address ? (
              <Row
                alignItems="center"
                gap="$1.5"
                paddingHorizontal="$2.5"
                paddingVertical="$1.5"
                borderRadius={999}
                backgroundColor="$surfaceVariant"
                onPress={onOpenHistory}
                accessibilityRole="button"
                accessibilityLabel={t("swap.history")}
                testID="dex-wallet-chip"
              >
                <Stack
                  width={8}
                  height={8}
                  borderRadius={4}
                  backgroundColor="$success"
                />
                <InlineText fontSize={12} fontWeight="700">
                  {shortenAddress(address)}
                </InlineText>
              </Row>
            ) : (
              <PrimaryButton
                height={32}
                paddingHorizontal="$3"
                fontSize={12}
                onPress={() => requestAuth({ type: "open_swap" })}
                testID="dex-create-wallet"
              >
                {t("dex.createWallet")}
              </PrimaryButton>
            )}
          </Row>

          <HorizontalScroll>
            {[
              { id: "all" as const, label: t("dex.allChains") },
              ...(Object.keys(CHAINS) as ChainId[]).map((id) => ({
                id,
                label: CHAINS[id].name,
              })),
            ].map((item) => {
              const selected = chain === item.id;
              return (
                <Row
                  key={item.id}
                  alignItems="center"
                  gap="$1.5"
                  paddingHorizontal="$3"
                  paddingVertical="$1.5"
                  borderRadius={999}
                  backgroundColor={selected ? "$color" : "$surfaceVariant"}
                  onPress={() => setChain(item.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  {item.id !== "all" ? <ChainDot chain={item.id} /> : null}
                  <InlineText
                    fontSize={13}
                    fontWeight="700"
                    color={selected ? "$background" : "$color"}
                  >
                    {item.label}
                  </InlineText>
                </Row>
              );
            })}
          </HorizontalScroll>

          <Tabs
            value={tab}
            options={[
              { value: "hot", label: t("dex.tab.hot") },
              { value: "gainers", label: t("dex.tab.gainers") },
              { value: "new", label: t("dex.tab.new") },
              { value: "watchlist", label: t("dex.tab.watchlist") },
            ]}
            onChange={setTab}
            accessibilityLabel={t("dex.marketTitle")}
          />
          <Row alignItems="center" justifyContent="space-between">
            <Body fontSize={12}>24h</Body>
            <Row alignItems="center" gap="$2">
              <Body fontSize={12}>{t("dex.filter.liquidity")}</Body>
              <Switch
                value={minLiquidity}
                onValueChange={setMinLiquidity}
                accessibilityLabel={t("dex.filter.liquidity")}
                testID="dex-liquidity-filter"
              />
            </Row>
          </Row>
          <Row justifyContent="space-between">
            <Body fontSize={11} flex={1}>
              {t("dex.col.token")} · {t("dex.col.liquidity")}
            </Body>
            <Body fontSize={11} width={80} textAlign="center">
              {t("dex.col.trend")}
            </Body>
            <Body fontSize={11} width={110} textAlign="right">
              {t("dex.col.price")}
            </Body>
          </Row>

          {tokens.data ? (
            rows.length === 0 ? (
              <Body>{t("state.empty")}</Body>
            ) : (
              rows.map((item) => (
                <TokenRow
                  key={`${item.token.chain}:${item.token.address}`}
                  item={item}
                  locale={locale}
                  newLabel={t("dex.new")}
                  liquidityLabel={t("dex.liquidity")}
                  onPress={() => onOpenToken(item)}
                  onLongPress={() => {
                    const key = `${item.token.chain}:${item.token.address}`;
                    setWatchlist((prev) =>
                      prev.includes(key)
                        ? prev.filter((k) => k !== key)
                        : [...prev, key],
                    );
                  }}
                />
              ))
            )
          ) : (
            <Stack gap="$2">
              <SkeletonBlock height={60} />
              <SkeletonBlock height={60} />
              <SkeletonBlock height={60} />
              <SkeletonBlock height={60} />
            </Stack>
          )}
        </Content>
      </PageScroll>
    </Page>
  );
}

function TokenRow({
  item,
  locale,
  newLabel,
  liquidityLabel,
  onPress,
  onLongPress,
}: {
  item: TokenSummary;
  locale: string;
  newLabel: string;
  liquidityLabel: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <Row
      alignItems="center"
      gap="$3"
      paddingVertical="$2.5"
      borderBottomWidth={1}
      borderColor="$borderColor"
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={item.token.symbol}
      testID={`token-${item.token.symbol}`}
    >
      <TokenAvatar token={item.token} />
      <Stack flex={1} gap="$0.5">
        <Row alignItems="center" gap="$1.5">
          <SectionTitle fontSize={15}>{item.token.symbol}</SectionTitle>
          {item.isNew ? (
            <Stack
              paddingHorizontal={6}
              paddingVertical={1}
              borderRadius={4}
              backgroundColor="$warning"
            >
              <InlineText fontSize={10} fontWeight="800" color="$onPrimary">
                {newLabel}
              </InlineText>
            </Stack>
          ) : null}
        </Row>
        <Body fontSize={12}>
          ${formatCompactNumber(item.mcapUsd, locale)} · {liquidityLabel} $
          {formatCompactNumber(item.liquidityUsd, locale)}
        </Body>
      </Stack>
      <Stack width={80} alignItems="center">
        <Sparkline
          values={item.sparkline}
          tone={item.change24hPct >= 0 ? "positive" : "negative"}
        />
      </Stack>
      <Stack width={110} alignItems="flex-end" gap="$0.5">
        <TokenPrice price={item.priceUsd} locale={locale} size={14} />
        <Stack
          paddingHorizontal={6}
          paddingVertical={2}
          borderRadius={4}
          backgroundColor={
            item.change24hPct >= 0 ? "$pricePositive" : "$priceNegative"
          }
        >
          <InlineText fontSize={11} fontWeight="800" color="$onPrimary">
            {item.change24hPct >= 0 ? "+" : ""}
            {item.change24hPct.toFixed(1)}%
          </InlineText>
        </Stack>
      </Stack>
    </Row>
  );
}
