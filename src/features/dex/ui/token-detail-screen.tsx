import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import type { ChainId } from "../../../core/gateways/types";
import {
  formatCompactNumber,
  formatMoney,
  formatTokenPrice,
  shortenAddress,
} from "../../../core/i18n/format";
import {
  AppIcon,
  Body,
  CandleChart,
  Content,
  IconButton,
  InlineText,
  Page,
  PageScroll,
  PageState,
  PriceChange,
  Row,
  ScreenHeader,
  SectionTitle,
  SkeletonBlock,
  Stack,
  Tabs,
  toast,
  useTheme,
} from "../../../design-system";
import { useSession } from "../../session/hooks/use-session";
import { useWalletBalances } from "../../wallet/hooks/use-wallet";
import { useCandles, useDexToken, useDexTrades } from "../hooks/use-dex";
import type { CandleInterval } from "../model/dex";
import { ChainDot, TokenAvatar, TokenPrice, chainName, fill } from "./shared";

const INTERVALS: CandleInterval[] = ["15m", "1h", "4h", "1d", "1w"];

/** D-02 代币详情：价格前导零折叠、四格统计、K 线、安全检测（不过则 warn 边框 + 风险提示）、合约地址、成交 / 持有者 / 信息、底部买入 / 卖出。 */
export function TokenDetailScreen({
  chain,
  address,
  onBack,
  onSwap,
}: {
  chain: ChainId;
  address: string;
  onBack: () => void;
  onSwap: (side: "buy" | "sell") => void;
}) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const theme = useTheme();
  const detail = useDexToken(chain, address);
  const [interval, setInterval] = useState<CandleInterval>("4h");
  const candles = useCandles(chain, address, interval);
  const trades = useDexTrades(chain, address);
  const [tab, setTab] = useState<"trades" | "holders" | "info">("trades");
  const session = useSession();
  const balances = useWalletBalances(session.data?.address, chain);
  const held = balances.data?.find(
    (item) => item.token.address.toLowerCase() === address.toLowerCase(),
  );

  if (detail.isError)
    return (
      <Page>
        <PageState title={t("state.error")} />
      </Page>
    );
  const data = detail.data;
  const security = data?.security;
  const passedAll = security ? security.passed === security.total : true;

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={data?.token.symbol ?? ""}
          subtitle={
            data ? `${data.token.name} · ${chainName(chain)}` : undefined
          }
          onBack={onBack}
          backLabel={t("action.back")}
          action={
            data ? (
              <Row alignItems="center" gap="$2">
                <TokenAvatar token={data.token} size={32} />
                <IconButton
                  label={t("dex.tab.watchlist")}
                  icon="star-outline"
                  size={28}
                  onPress={() => toast(t("dex.watchlistAdded"), "success")}
                />
              </Row>
            ) : undefined
          }
        />
      </Content>
      <PageScroll>
        <Content paddingTop="$1" gap="$4" paddingBottom={120}>
          {data ? (
            <>
              <Stack gap="$1">
                <Row alignItems="baseline" gap="$3">
                  <TokenPrice
                    price={data.priceUsd}
                    locale={locale}
                    size={30}
                    big
                  />
                  <PriceChange value={data.change24hPct} />
                </Row>
                <Body fontSize={12}>
                  {t("dex.high24h")} {formatTokenPrice(data.high24hUsd, locale)}{" "}
                  · {t("dex.low24h")} {formatTokenPrice(data.low24hUsd, locale)}
                </Body>
              </Stack>
              <Row gap="$2">
                {[
                  {
                    label: t("dex.mcap"),
                    value: `$${formatCompactNumber(data.mcapUsd, locale)}`,
                  },
                  {
                    label: t("dex.liquidity"),
                    value: `$${formatCompactNumber(data.liquidityUsd, locale)}`,
                  },
                  {
                    label: t("dex.volume24h"),
                    value: `$${formatCompactNumber(data.volume24hUsd, locale)}`,
                  },
                  {
                    label: t("dex.holders"),
                    value: formatCompactNumber(data.holders, locale),
                  },
                ].map((cell) => (
                  <Stack
                    key={cell.label}
                    flex={1}
                    padding="$2.5"
                    borderRadius="$3"
                    backgroundColor="$surfaceVariant"
                    gap="$0.5"
                  >
                    <Body fontSize={10}>{cell.label}</Body>
                    <InlineText fontSize={13} fontWeight="800">
                      {cell.value}
                    </InlineText>
                  </Stack>
                ))}
              </Row>
              <Row gap="$1.5">
                {INTERVALS.map((option) => (
                  <Stack
                    key={option}
                    flex={1}
                    alignItems="center"
                    paddingVertical="$1"
                    borderRadius="$2"
                    backgroundColor={
                      interval === option ? "$surfaceVariant" : "transparent"
                    }
                    onPress={() => setInterval(option)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: interval === option }}
                  >
                    <InlineText
                      fontSize={11}
                      fontWeight="700"
                      color={interval === option ? "$color" : "$textMuted"}
                    >
                      {option.toUpperCase()}
                    </InlineText>
                  </Stack>
                ))}
                <Stack flex={1} alignItems="center" paddingVertical="$1">
                  <InlineText fontSize={11} fontWeight="700" color="$textMuted">
                    {t("dex.depth")}
                  </InlineText>
                </Stack>
              </Row>
              {candles.data ? (
                <CandleChart candles={candles.data} height={200} />
              ) : (
                <SkeletonBlock height={200} />
              )}

              {security ? (
                <Stack
                  padding="$3"
                  borderRadius="$4"
                  backgroundColor="$surfaceVariant"
                  gap="$2"
                  borderWidth={passedAll ? 0 : 1.5}
                  borderColor="$warning"
                  testID="token-security"
                >
                  <Row justifyContent="space-between" alignItems="center">
                    <SectionTitle fontSize={14}>
                      {t("dex.security")}
                    </SectionTitle>
                    <InlineText
                      fontSize={12}
                      fontWeight="800"
                      color={passedAll ? "$success" : "$warning"}
                    >
                      {fill(t("dex.security.passed"), {
                        passed: security.passed,
                        total: security.total,
                      })}
                    </InlineText>
                  </Row>
                  <Row flexWrap="wrap" gap="$2">
                    <Check
                      ok={security.openSource}
                      label={
                        security.openSource
                          ? t("dex.security.openSource")
                          : t("dex.security.closedSource")
                      }
                    />
                    <Check
                      ok={!security.mintable}
                      label={
                        security.mintable
                          ? t("dex.security.mintable")
                          : t("dex.security.noMint")
                      }
                    />
                    <Check
                      ok={
                        security.buyTaxBps <= 500 && security.sellTaxBps <= 500
                      }
                      label={fill(t("dex.security.tax"), {
                        buy: `${(security.buyTaxBps / 100).toFixed(0)}%`,
                        sell: `${(security.sellTaxBps / 100).toFixed(0)}%`,
                      })}
                    />
                    <Check
                      ok={security.top10Pct <= 50 && !security.honeypot}
                      label={
                        security.honeypot
                          ? t("dex.security.honeypot")
                          : fill(t("dex.security.top10"), {
                              pct: `${security.top10Pct}%`,
                            })
                      }
                    />
                  </Row>
                  <Row
                    alignItems="center"
                    justifyContent="space-between"
                    onPress={() =>
                      void Clipboard.setStringAsync(data.token.address).then(
                        () => toast(t("receive.copied"), "success"),
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={t("dex.contract")}
                  >
                    <Body fontSize={12}>{t("dex.contract")}</Body>
                    <Row alignItems="center" gap="$1">
                      <ChainDot chain={chain} size={8} />
                      <InlineText fontSize={12} fontWeight="700">
                        {shortenAddress(data.token.address, 6, 4)}
                      </InlineText>
                      <AppIcon
                        name="content-copy"
                        size={14}
                        colorToken="textMuted"
                      />
                    </Row>
                  </Row>
                </Stack>
              ) : null}

              <Tabs
                value={tab}
                options={[
                  { value: "trades", label: t("dex.tab.trades") },
                  { value: "holders", label: t("dex.tab.holders") },
                  { value: "info", label: t("dex.tab.info") },
                ]}
                onChange={setTab}
                accessibilityLabel={t("dex.tab.trades")}
              />
              {tab === "trades" ? (
                <Stack>
                  <Row justifyContent="space-between" paddingVertical="$1">
                    <Body fontSize={11} width={80}>
                      {t("dex.trades.time")}
                    </Body>
                    <Body fontSize={11} width={50}>
                      {t("dex.trades.type")}
                    </Body>
                    <Body fontSize={11} flex={1} textAlign="right">
                      {t("dex.trades.amount")}
                    </Body>
                    <Body fontSize={11} width={80} textAlign="right">
                      {t("dex.trades.value")}
                    </Body>
                  </Row>
                  {(trades.data ?? []).map((trade) => (
                    <Row
                      key={trade.id}
                      justifyContent="space-between"
                      paddingVertical="$1.5"
                      borderBottomWidth={1}
                      borderColor="$borderColor"
                    >
                      <Body fontSize={12} width={80}>
                        {new Date(trade.at).toTimeString().slice(0, 8)}
                      </Body>
                      <InlineText
                        fontSize={12}
                        fontWeight="700"
                        width={50}
                        color={
                          trade.side === "buy"
                            ? "$pricePositive"
                            : "$priceNegative"
                        }
                      >
                        {trade.side === "buy"
                          ? t("dex.trades.buy")
                          : t("dex.trades.sell")}
                      </InlineText>
                      <InlineText
                        fontSize={12}
                        flex={1}
                        textAlign="right"
                        fontVariant={["tabular-nums"]}
                      >
                        {formatCompactNumber(
                          Number(
                            formatMoney(trade.amount, locale, {
                              withSymbol: false,
                            }).replace(/,/g, ""),
                          ),
                          locale,
                        )}
                      </InlineText>
                      <InlineText
                        fontSize={12}
                        width={80}
                        textAlign="right"
                        fontVariant={["tabular-nums"]}
                      >
                        ${trade.usd.toFixed(1)}
                      </InlineText>
                    </Row>
                  ))}
                </Stack>
              ) : tab === "info" ? (
                <Body>
                  {data.description
                    ? typeof data.description === "string"
                      ? data.description
                      : (data.description[locale] ?? data.description.en ?? "")
                    : "—"}
                </Body>
              ) : (
                <Body>
                  {fill(t("predict.holders"), {
                    n: data.holders.toLocaleString(),
                  })}
                </Body>
              )}
            </>
          ) : (
            <Stack gap="$3">
              <SkeletonBlock height={40} width={220} />
              <SkeletonBlock height={60} />
              <SkeletonBlock height={200} />
            </Stack>
          )}
        </Content>
      </PageScroll>
      {data ? (
        <Stack
          position="absolute"
          left={0}
          right={0}
          bottom={0}
          padding="$4"
          paddingBottom={insets.bottom + 12}
          gap="$2"
          backgroundColor="$background"
          borderTopWidth={1}
          borderColor="$borderColor"
        >
          {!passedAll ? (
            <Row alignItems="center" gap="$2">
              <AppIcon name="alert-outline" size={16} colorToken="warning" />
              <Body fontSize={12} color="$warning">
                {t("dex.security.risk")}
              </Body>
            </Row>
          ) : null}
          <Row gap="$2">
            <Stack
              flex={1}
              height={52}
              borderRadius="$4"
              backgroundColor="$primary"
              alignItems="center"
              justifyContent="center"
              onPress={() => onSwap("buy")}
              accessibilityRole="button"
              testID="token-buy"
              pressStyle={{ opacity: 0.85 }}
            >
              <InlineText color="$onPrimary" fontWeight="800">
                {t("dex.buy")}
              </InlineText>
              <InlineText color="$onPrimary" fontSize={11} opacity={0.85}>
                {fill(t("dex.buyHint"), {
                  tokens: chain === "bsc" ? "BNB / USDT" : "ETH / USDC",
                })}
              </InlineText>
            </Stack>
            <Stack
              flex={1}
              height={52}
              borderRadius="$4"
              backgroundColor="$surfaceVariant"
              alignItems="center"
              justifyContent="center"
              onPress={() => onSwap("sell")}
              accessibilityRole="button"
              testID="token-sell"
              pressStyle={{ opacity: 0.85 }}
              style={{ borderColor: theme.borderColor.val, borderWidth: 1 }}
            >
              <InlineText fontWeight="800">{t("dex.sell")}</InlineText>
              <InlineText fontSize={11} color="$textMuted">
                {fill(t("dex.sellHint"), {
                  amount: held
                    ? `${formatCompactNumber(Number(formatMoney(held.amount, locale, { withSymbol: false }).replace(/,/g, "")), locale)} ${data.token.symbol}`
                    : `0 ${data.token.symbol}`,
                })}
              </InlineText>
            </Stack>
          </Row>
        </Stack>
      ) : null}
    </Page>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Row alignItems="center" gap="$1" width="47%">
      <AppIcon
        name={ok ? "check-circle" : "alert-circle"}
        size={14}
        colorToken={ok ? "success" : "warning"}
      />
      <Body fontSize={12} color="$color" numberOfLines={1}>
        {label}
      </Body>
    </Row>
  );
}
