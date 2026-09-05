import { useEffect, useMemo, useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import {
  formatCents,
  formatDate,
  formatDateTime,
  formatPercentCents,
  NO_QUOTE,
  formatUsd,
} from "../../../core/i18n/format";
import { pickTranslation } from "../../../core/i18n/localized-text";
import {
  Body,
  ChipRow,
  Content,
  DetailRow,
  InlineText,
  Page,
  PageScroll,
  PageState,
  PriceLineChart,
  Row,
  ScreenHeader,
  SectionTitle,
  SegmentedControl,
  SkeletonBlock,
  Stack,
  Tabs,
  useTheme,
  type ChartSample,
  type ChartSeries,
} from "../../../design-system";
import {
  useAdjudication,
  useFeeBps,
  useMarketStream,
  useOrderBook,
  usePredictEvent,
  usePriceHistories,
  useTrades,
} from "../hooks/use-predict";
import type { Market, OrderSide, Outcome, PriceRange } from "../model/predict";
import { OrderBookView } from "./order-book";
import { OrderSheet, type OrderSheetHandle } from "./order-sheet";
import { StatusBadge, closesText, fill, outcomeLabel } from "./shared";

const RANGES: PriceRange[] = ["1h", "6h", "1d", "1w", "1m", "all"];

function clockTime(ms: number, locale: string): string {
  return new Date(ms).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
/** 多结果事件最多画几条线（网页版 MAX_VISIBLE_HISTORY_LINES） */
const MAX_LINES = 4;

/**
 * P-02 事件详情：状态徽章、Yes 概率 + 走势（可刻度）、Yes/No 选择器、
 * 盘口 / 成交 / 规则 / 持有人 Tabs、底部双 CTA。
 */
export function EventDetailScreen({
  eventId,
  marketId,
  initialOutcome,
  onBack,
  onOpenSettlement,
  onOpenTransfer,
}: {
  eventId: string;
  marketId?: string;
  initialOutcome?: Outcome;
  onBack: () => void;
  onOpenSettlement: (marketId: string, eventId: string) => void;
  onOpenTransfer: (amount?: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const event = usePredictEvent(eventId);
  const [selectedMarketId, setSelectedMarketId] = useState<string | undefined>(
    marketId,
  );
  const market: Market | undefined =
    event.data?.markets.find(
      (item) => item.id === (selectedMarketId ?? marketId),
    ) ?? event.data?.markets[0];
  const [range, setRange] = useState<PriceRange>("1d");
  const [tab, setTab] = useState<"book" | "trades" | "rules" | "holders">(
    "book",
  );
  const [bookOutcome, setBookOutcome] = useState<Outcome>("yes");
  const [scrub, setScrub] = useState<ChartSample | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  // 走势线：二元事件一条线；多结果事件 = 当前选中 + 概率最高的几条（最多 4 条）
  const chartMarkets = useMemo(() => {
    const markets = event.data?.markets ?? [];
    if (!market) return [];
    if (markets.length <= 1) return [market];
    const others = markets
      .filter((item) => item.id !== market.id)
      .sort((a, b) => (b.yesPriceCents ?? -1) - (a.yesPriceCents ?? -1));
    return [market, ...others].slice(0, MAX_LINES);
  }, [event.data?.markets, market]);
  const histories = usePriceHistories(
    chartMarkets.map((item) => item.id),
    range,
  );
  const book = useOrderBook(market?.id);
  const trades = useTrades(tab === "trades" ? market?.id : undefined);
  // 费率按代币从 clob 读，事件级没有
  const fee = useFeeBps(market?.id);
  // 详情页所有结果走实时行情（簿 + 价格）
  useMarketStream(event.data?.markets.map((item) => item.id) ?? []);
  const adjudication = useAdjudication(market?.id);
  const orderSheet = useRef<OrderSheetHandle>(null);
  const autoOpened = useRef(false);
  useEffect(() => {
    if (initialOutcome && market && !autoOpened.current) {
      autoOpened.current = true;
      const timer = setTimeout(
        () => orderSheet.current?.open(market, initialOutcome),
        250,
      );
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [initialOutcome, market]);

  const yes = market?.yesPriceCents ?? null;
  const primaryHistory = histories[0]?.data;
  const first = primaryHistory?.[0]?.priceCents;
  const change = yes !== null && first !== undefined ? yes - first : null;
  const lineColors = [
    (change ?? 0) >= 0 ? theme.pricePositive.val : theme.priceNegative.val,
    theme.info.val,
    theme.warning.val,
    theme.textMuted.val,
  ];
  const series: ChartSeries[] = chartMarkets.map((item, index) => ({
    key: item.id,
    label: item.outcomeLabel
      ? pickTranslation(item.outcomeLabel, locale)
      : outcomeLabel("yes"),
    color: lineColors[index] ?? theme.textMuted.val,
    points: (histories[index]?.data ?? []).map((point) => ({
      t: new Date(point.t).getTime(),
      v: point.priceCents,
    })),
  }));
  const historyLoading = histories.some(
    (query) => query.data === undefined && !query.isError,
  );
  const scrubValue = market && scrub ? scrub.values[market.id] : undefined;
  const shownCents =
    scrubValue !== undefined && scrubValue !== null ? scrubValue : yes;
  // 轴标签：小时级区间只给时分；1D 跨到昨天，要带月日；更长的只给月日
  const formatAxisTime = (ms: number) => {
    const iso = new Date(ms).toISOString();
    if (range === "1h" || range === "6h") return clockTime(ms, locale);
    if (range === "1d")
      return `${formatDate(iso, locale)} ${clockTime(ms, locale)}`;
    return formatDate(iso, locale);
  };

  if (event.isError)
    return (
      <Page>
        <PageState title={t("state.error")} />
      </Page>
    );
  const status = adjudication.data?.status ?? "trading";
  const openOrder = (
    outcome: Outcome,
    side: OrderSide = "buy",
    limitPriceCents?: number,
  ) =>
    market && orderSheet.current?.open(market, outcome, side, limitPriceCents);
  const title = event.data ? pickTranslation(event.data.title, locale) : "";
  const maxReturn = (price: number | null) =>
    price === null || price <= 0
      ? NO_QUOTE
      : `${Math.round(((100 - price) / price) * 100)}%`;

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={
            event.data
              ? pickTranslation(event.data.category, locale).toUpperCase()
              : ""
          }
          onBack={onBack}
          backLabel={t("action.back")}
          action={<StatusBadge status={status} />}
        />
      </Content>
      <PageScroll scrollEnabled={!scrubbing}>
        <Content paddingTop="$1" gap="$4" paddingBottom={120}>
          {event.data && market ? (
            <>
              <Stack gap="$1">
                <SectionTitle fontSize={20}>{title}</SectionTitle>
                <Body fontSize={12}>
                  {closesText(event.data.endsAt, locale, t)} ·{" "}
                  {fill(t("predict.volume"), {
                    amount: formatUsd(event.data.volumeUsd, locale, {
                      compact: true,
                    }),
                  })}
                </Body>
              </Stack>
              {event.data.markets.length > 1 ? (
                <ChipRow
                  value={market.id}
                  options={event.data.markets.map((item) => ({
                    value: item.id,
                    label: `${pickTranslation(item.outcomeLabel, locale)} ${formatPercentCents(item.yesPriceCents)}`,
                  }))}
                  onChange={setSelectedMarketId}
                  accessibilityLabel={t("predict.outcomes")}
                  testID="detail-market"
                />
              ) : null}
              <Row alignItems="flex-end" gap="$3">
                <Stack>
                  <InlineText
                    fontSize={40}
                    fontWeight="900"
                    lineHeight={44}
                    color={
                      shownCents === null
                        ? "$textMuted"
                        : shownCents >= 50
                          ? "$success"
                          : "$danger"
                    }
                    testID="detail-price"
                  >
                    {formatPercentCents(shownCents)}
                  </InlineText>
                  <Body fontSize={12}>
                    {scrub
                      ? formatDateTime(new Date(scrub.t).toISOString(), locale)
                      : t("predict.yesProbability")}
                  </Body>
                </Stack>
                {!scrub && change !== null ? (
                  <Stack paddingBottom="$3">
                    <InlineText
                      fontWeight="700"
                      color={change >= 0 ? "$pricePositive" : "$priceNegative"}
                    >
                      {change >= 0 ? "+" : ""}
                      {change.toFixed(1)}
                    </InlineText>
                    <Body fontSize={11}>{t("predict.chart.change")}</Body>
                  </Stack>
                ) : null}
              </Row>
              {historyLoading && series.every((s) => s.points.length === 0) ? (
                <SkeletonBlock height={180} />
              ) : (
                <PriceLineChart
                  series={series}
                  height={180}
                  baseline={50}
                  formatValue={(value) => `${Math.round(value)}%`}
                  formatTime={formatAxisTime}
                  onScrub={setScrub}
                  onScrubbing={setScrubbing}
                  empty={<Body fontSize={12}>{t("predict.chart.empty")}</Body>}
                />
              )}
              {series.length > 1 ? (
                <Row gap="$3" flexWrap="wrap">
                  {series.map((item) => (
                    <Row key={item.key} alignItems="center" gap="$1">
                      <Stack
                        width={8}
                        height={8}
                        borderRadius={4}
                        style={{ backgroundColor: item.color }}
                      />
                      <Body fontSize={11}>
                        {item.label}
                        {scrub && scrub.values[item.key] !== null
                          ? ` ${formatPercentCents(scrub.values[item.key] ?? null)}`
                          : ""}
                      </Body>
                    </Row>
                  ))}
                </Row>
              ) : null}
              <SegmentedControl
                size="sm"
                value={range}
                options={RANGES.map((option) => ({
                  value: option,
                  label:
                    option === "all"
                      ? t("predict.leaderboard.all")
                      : option.toUpperCase(),
                }))}
                onChange={setRange}
                accessibilityLabel={t("predict.tab.book")}
                testID="detail-range"
              />

              <Row gap="$2">
                {(["yes", "no"] as const).map((outcome) => {
                  const price =
                    yes === null ? null : outcome === "yes" ? yes : 100 - yes;
                  return (
                    <Stack
                      key={outcome}
                      flex={1}
                      padding="$3"
                      borderRadius="$4"
                      backgroundColor="$surfaceVariant"
                      gap="$0.5"
                      onPress={() => openOrder(outcome)}
                      accessibilityRole="button"
                      testID={`detail-${outcome}`}
                      pressStyle={{ opacity: 0.8 }}
                    >
                      <Row justifyContent="space-between">
                        <InlineText
                          fontWeight="800"
                          color={outcome === "yes" ? "$success" : "$danger"}
                        >
                          {outcomeLabel(outcome)}
                        </InlineText>
                        <InlineText fontSize={18} fontWeight="900">
                          {formatCents(price)}
                        </InlineText>
                      </Row>
                      <Body fontSize={11}>
                        {t("predict.buy")} · {t("predict.win1")}
                      </Body>
                    </Stack>
                  );
                })}
              </Row>

              {status !== "trading" ? (
                <Row
                  alignItems="center"
                  justifyContent="space-between"
                  padding="$3"
                  borderRadius="$4"
                  backgroundColor="$surfaceVariant"
                  onPress={() => onOpenSettlement(market.id, event.data.id)}
                  accessibilityRole="button"
                  testID="detail-settlement"
                >
                  <Stack>
                    <SectionTitle fontSize={14}>
                      {t("predict.settlement.title")}
                    </SectionTitle>
                    <Body fontSize={12}>
                      {t(`predict.status.${status}`)}
                      {adjudication.data?.proposedOutcome
                        ? ` · ${outcomeLabel(adjudication.data.proposedOutcome)}`
                        : ""}
                    </Body>
                  </Stack>
                  <InlineText color="$primary" fontWeight="700">
                    ›
                  </InlineText>
                </Row>
              ) : null}

              <Tabs
                value={tab}
                options={[
                  { value: "book", label: t("predict.tab.book") },
                  { value: "trades", label: t("predict.tab.trades") },
                  { value: "rules", label: t("predict.tab.rules") },
                  {
                    value: "holders",
                    label:
                      event.data.holders === null
                        ? t("predict.tab.holders")
                        : `${t("predict.tab.holders")} ${event.data.holders.toLocaleString()}`,
                  },
                ]}
                onChange={setTab}
                accessibilityLabel={t("predict.tab.book")}
              />
              {tab === "book" ? (
                <OrderBookView
                  book={book.data}
                  outcome={bookOutcome}
                  onOutcomeChange={setBookOutcome}
                  onPickPrice={
                    status === "trading"
                      ? (priceCents, side) =>
                          openOrder(bookOutcome, side, priceCents)
                      : undefined
                  }
                />
              ) : tab === "rules" ? (
                <Stack gap="$2">
                  <SectionTitle fontSize={14}>
                    {t("predict.rules.title")}
                  </SectionTitle>
                  <Body>{pickTranslation(event.data.rules, locale)}</Body>
                  <DetailRow
                    label={t("predict.rules.resolver")}
                    value={t("predict.rules.resolverValue")}
                  />
                  <DetailRow
                    label={t("predict.rules.disputeWindow")}
                    value={fill(t("predict.rules.disputeWindowValue"), {
                      hours: Math.round(event.data.disputeWindowSec / 3600),
                    })}
                  />
                  <DetailRow
                    label={t("predict.rules.fee")}
                    value={fill(t("predict.rules.feeValue"), {
                      pct:
                        fee.data === undefined
                          ? NO_QUOTE
                          : `${(fee.data / 100).toFixed(2)}%`,
                    })}
                  />
                  <Body fontSize={12}>
                    {pickTranslation(event.data.resolutionSource, locale)}
                  </Body>
                </Stack>
              ) : tab === "trades" ? (
                <Stack gap="$1" testID="detail-trades">
                  <Row paddingVertical="$1">
                    <Body fontSize={11} flex={1.2}>
                      {t("predict.trades.time")}
                    </Body>
                    <Body fontSize={11} flex={1} textAlign="center">
                      {t("predict.trades.price")}
                    </Body>
                    <Body fontSize={11} flex={1} textAlign="right">
                      {t("predict.trades.shares")}
                    </Body>
                  </Row>
                  {trades.data ? (
                    trades.data.length === 0 ? (
                      <Body fontSize={12}>{t("predict.trades.empty")}</Body>
                    ) : (
                      trades.data.slice(0, 20).map((trade) => (
                        <Row
                          key={trade.id}
                          alignItems="center"
                          paddingVertical="$1.5"
                          borderBottomWidth={1}
                          borderColor="$borderColor"
                        >
                          <Stack flex={1.2}>
                            <Body fontSize={12}>
                              {formatDateTime(trade.at, locale)}
                            </Body>
                            <InlineText
                              fontSize={11}
                              fontWeight="700"
                              color={
                                trade.side === "buy" ? "$success" : "$danger"
                              }
                            >
                              {trade.side === "buy"
                                ? t("predict.buy")
                                : t("predict.sell")}{" "}
                              {outcomeLabel(trade.outcome)}
                            </InlineText>
                          </Stack>
                          <InlineText
                            flex={1}
                            fontSize={13}
                            fontWeight="700"
                            textAlign="center"
                          >
                            {formatCents(
                              trade.outcome === "yes"
                                ? trade.priceCents
                                : Math.round((100 - trade.priceCents) * 10) /
                                    10,
                            )}
                          </InlineText>
                          <InlineText flex={1} fontSize={13} textAlign="right">
                            {trade.shares.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                            })}
                          </InlineText>
                        </Row>
                      ))
                    )
                  ) : trades.isError ? (
                    <Body fontSize={12} color="$priceNegative">
                      {trades.error instanceof Error
                        ? trades.error.message
                        : String(trades.error)}
                    </Body>
                  ) : (
                    <SkeletonBlock height={120} />
                  )}
                </Stack>
              ) : (
                <Body>
                  {event.data.holders === null
                    ? t("state.empty")
                    : fill(t("predict.holders"), {
                        n: event.data.holders.toLocaleString(),
                      })}
                </Body>
              )}
            </>
          ) : (
            <Stack gap="$3">
              <SkeletonBlock height={28} width={260} />
              <SkeletonBlock height={180} />
              <SkeletonBlock height={80} />
            </Stack>
          )}
        </Content>
      </PageScroll>
      {market && status === "trading" ? (
        <Row
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
          <Stack
            flex={1}
            height={52}
            borderRadius="$4"
            backgroundColor="$success"
            alignItems="center"
            justifyContent="center"
            onPress={() => openOrder("yes")}
            accessibilityRole="button"
            testID="cta-yes"
            pressStyle={{ opacity: 0.85 }}
          >
            <InlineText color="$onPrimary" fontWeight="800">
              {t("predict.buyYes")} {formatCents(yes)}
            </InlineText>
            <InlineText color="$onPrimary" fontSize={11} opacity={0.85}>
              {fill(t("predict.maxReturn"), { pct: maxReturn(yes) })}
            </InlineText>
          </Stack>
          <Stack
            flex={1}
            height={52}
            borderRadius="$4"
            backgroundColor="$danger"
            alignItems="center"
            justifyContent="center"
            onPress={() => openOrder("no")}
            accessibilityRole="button"
            testID="cta-no"
            pressStyle={{ opacity: 0.85 }}
          >
            <InlineText color="$onPrimary" fontWeight="800">
              {t("predict.buyNo")}{" "}
              {formatCents(yes === null ? null : 100 - yes)}
            </InlineText>
            <InlineText color="$onPrimary" fontSize={11} opacity={0.85}>
              {fill(t("predict.maxReturn"), {
                pct: maxReturn(yes === null ? null : 100 - yes),
              })}
            </InlineText>
          </Stack>
        </Row>
      ) : null}
      <OrderSheet
        ref={orderSheet}
        event={event.data}
        onInsufficient={onOpenTransfer}
      />
    </Page>
  );
}
