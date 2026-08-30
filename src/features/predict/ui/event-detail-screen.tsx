import { useEffect, useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import {
  formatCents,
  formatDateTime,
  formatUsd,
} from "../../../core/i18n/format";
import { pickTranslation } from "../../../core/i18n/localized-text";
import {
  AreaChart,
  Body,
  Content,
  DetailRow,
  InlineText,
  Page,
  PageScroll,
  PageState,
  Row,
  ScreenHeader,
  SectionTitle,
  SegmentedControl,
  SkeletonBlock,
  Stack,
  Tabs,
} from "../../../design-system";
import {
  useAdjudication,
  useOrderBook,
  usePredictEvent,
  usePriceHistory,
} from "../hooks/use-predict";
import type { Market, Outcome, PriceRange } from "../model/predict";
import { OrderSheet, type OrderSheetHandle } from "./order-sheet";
import { StatusBadge, closesText, fill, outcomeLabel } from "./shared";

const RANGES: PriceRange[] = ["1h", "6h", "1d", "1w", "1m", "all"];

/** P-02 事件详情：状态徽章、Yes 概率 + 曲线、Yes/No 选择器、盘口 / 规则 Tabs、底部双 CTA。 */
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
  onOpenSettlement: (marketId: string) => void;
  onOpenTransfer: (amount?: string) => void;
}) {
  const insets = useSafeAreaInsets();
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
  const history = usePriceHistory(market?.id, range);
  const book = useOrderBook(market?.id);
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

  if (event.isError)
    return (
      <Page>
        <PageState title={t("state.error")} />
      </Page>
    );
  const yes = market?.yesPriceCents ?? 50;
  const first = history.data?.[0]?.priceCents;
  const change = first !== undefined ? yes - first : 0;
  const status = adjudication.data?.status ?? "trading";
  const openOrder = (outcome: Outcome) =>
    market && orderSheet.current?.open(market, outcome);
  const title = event.data ? pickTranslation(event.data.title, locale) : "";
  const maxReturn = (price: number) =>
    `${Math.round(((100 - price) / price) * 100)}%`;

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={event.data?.categoryTagId.toUpperCase() ?? ""}
          onBack={onBack}
          backLabel={t("action.back")}
          action={<StatusBadge status={status} />}
        />
      </Content>
      <PageScroll>
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
                <SegmentedControl
                  value={market.id}
                  options={event.data.markets.map((item) => ({
                    value: item.id,
                    label: `${pickTranslation(item.outcomeLabel, locale)} ${item.yesPriceCents}%`,
                  }))}
                  onChange={setSelectedMarketId}
                  accessibilityLabel={t("predict.outcomes")}
                />
              ) : null}
              <Row alignItems="flex-end" gap="$3">
                <Stack>
                  <InlineText
                    fontSize={40}
                    fontWeight="900"
                    lineHeight={44}
                    color={yes >= 50 ? "$success" : "$danger"}
                  >
                    {yes}%
                  </InlineText>
                  <Body fontSize={12}>{t("predict.yesProbability")}</Body>
                </Stack>
                <InlineText
                  fontWeight="700"
                  color={change >= 0 ? "$pricePositive" : "$priceNegative"}
                  paddingBottom="$4"
                >
                  {change >= 0 ? "+" : ""}
                  {change.toFixed(1)} {t("predict.today")}
                </InlineText>
              </Row>
              {history.data ? (
                <AreaChart
                  values={history.data.map((point) => point.priceCents)}
                  height={150}
                  tone={change >= 0 ? "positive" : "negative"}
                  baseline={50}
                />
              ) : (
                <SkeletonBlock height={150} />
              )}
              <Row gap="$1.5">
                {RANGES.map((option) => (
                  <Stack
                    key={option}
                    flex={1}
                    alignItems="center"
                    paddingVertical="$1"
                    borderRadius="$2"
                    backgroundColor={
                      range === option ? "$surfaceVariant" : "transparent"
                    }
                    onPress={() => setRange(option)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: range === option }}
                  >
                    <InlineText
                      fontSize={11}
                      fontWeight="700"
                      color={range === option ? "$color" : "$textMuted"}
                    >
                      {option === "all"
                        ? t("predict.leaderboard.all")
                        : option.toUpperCase()}
                    </InlineText>
                  </Stack>
                ))}
              </Row>

              <Row gap="$2">
                {(["yes", "no"] as const).map((outcome) => {
                  const price = outcome === "yes" ? yes : 100 - yes;
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
                  onPress={() => onOpenSettlement(market.id)}
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
                    label: `${t("predict.tab.holders")} ${event.data.holders.toLocaleString()}`,
                  },
                ]}
                onChange={setTab}
                accessibilityLabel={t("predict.tab.book")}
              />
              {tab === "book" ? (
                book.data ? (
                  <Stack gap="$2">
                    <Row justifyContent="space-between">
                      <Body fontSize={12}>
                        {t("predict.book.yes")} ·{" "}
                        {fill(t("predict.book.spread"), {
                          spread: formatCents(
                            Math.round(
                              ((book.data.asks[0]?.priceCents ?? 0) -
                                (book.data.bids[0]?.priceCents ?? 0)) *
                                10,
                            ) / 10,
                          ),
                        })}
                      </Body>
                      <Body fontSize={12}>
                        {fill(t("predict.book.tick"), {
                          tick: formatCents(book.data.tickCents),
                        })}
                      </Body>
                    </Row>
                    <Row gap="$3">
                      <BookSide
                        levels={book.data.bids}
                        tone="positive"
                        priceLabel={t("predict.book.bid")}
                        sharesLabel={t("predict.book.shares")}
                      />
                      <BookSide
                        levels={book.data.asks}
                        tone="negative"
                        priceLabel={t("predict.book.ask")}
                        sharesLabel={t("predict.book.shares")}
                        align="right"
                      />
                    </Row>
                  </Stack>
                ) : (
                  <SkeletonBlock height={160} />
                )
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
                      pct: `${(event.data.feeBps / 100).toFixed(2)}%`,
                    })}
                  />
                  <Body fontSize={12}>
                    {pickTranslation(event.data.resolutionSource, locale)}
                  </Body>
                </Stack>
              ) : tab === "trades" ? (
                <Stack gap="$1">
                  {(history.data ?? [])
                    .slice(-8)
                    .reverse()
                    .map((point, index) => (
                      <Row
                        key={point.t}
                        justifyContent="space-between"
                        paddingVertical="$1.5"
                        borderBottomWidth={1}
                        borderColor="$borderColor"
                      >
                        <Body fontSize={12}>
                          {formatDateTime(point.t, locale)}
                        </Body>
                        <InlineText
                          fontSize={12}
                          fontWeight="700"
                          color={index % 3 === 0 ? "$danger" : "$success"}
                        >
                          {index % 3 === 0
                            ? t("predict.sell")
                            : t("predict.buy")}{" "}
                          Yes
                        </InlineText>
                        <InlineText fontSize={12} fontWeight="700">
                          {formatCents(point.priceCents)}
                        </InlineText>
                      </Row>
                    ))}
                </Stack>
              ) : (
                <Body>
                  {fill(t("predict.holders"), {
                    n: event.data.holders.toLocaleString(),
                  })}
                </Body>
              )}
            </>
          ) : (
            <Stack gap="$3">
              <SkeletonBlock height={28} width={260} />
              <SkeletonBlock height={150} />
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
              {t("predict.buyNo")} {formatCents(100 - yes)}
            </InlineText>
            <InlineText color="$onPrimary" fontSize={11} opacity={0.85}>
              {fill(t("predict.maxReturn"), { pct: maxReturn(100 - yes) })}
            </InlineText>
          </Stack>
        </Row>
      ) : null}
      <OrderSheet
        ref={orderSheet}
        event={event.data}
        feeBps={event.data?.feeBps ?? 20}
        onInsufficient={onOpenTransfer}
      />
    </Page>
  );
}

function BookSide({
  levels,
  tone,
  priceLabel,
  sharesLabel,
  align = "left",
}: {
  levels: { priceCents: number; shares: number }[];
  tone: "positive" | "negative";
  priceLabel: string;
  sharesLabel: string;
  align?: "left" | "right";
}) {
  const max = Math.max(...levels.map((level) => level.shares), 1);
  const color = tone === "positive" ? "$pricePositive" : "$priceNegative";
  return (
    <Stack flex={1} gap="$1">
      <Row justifyContent="space-between">
        <Body fontSize={11}>{align === "left" ? priceLabel : sharesLabel}</Body>
        <Body fontSize={11}>{align === "left" ? sharesLabel : priceLabel}</Body>
      </Row>
      {levels.map((level) => (
        <Row
          key={level.priceCents}
          justifyContent="space-between"
          paddingVertical="$1"
          position="relative"
        >
          <Stack
            position="absolute"
            top={0}
            bottom={0}
            left={align === "right" ? 0 : undefined}
            right={align === "left" ? 0 : undefined}
            width={`${(level.shares / max) * 100}%`}
            backgroundColor={color}
            opacity={0.14}
            borderRadius="$1"
          />
          <InlineText
            fontSize={12}
            fontWeight="700"
            color={align === "left" ? color : "$color"}
          >
            {align === "left"
              ? formatCents(level.priceCents)
              : level.shares.toLocaleString()}
          </InlineText>
          <InlineText
            fontSize={12}
            fontWeight="700"
            color={align === "left" ? "$color" : color}
          >
            {align === "left"
              ? level.shares.toLocaleString()
              : formatCents(level.priceCents)}
          </InlineText>
        </Row>
      ))}
    </Stack>
  );
}
