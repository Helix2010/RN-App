import { useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import {
  formatCents,
  formatDateTime,
  formatMoney,
  formatUsd,
} from "../../../core/i18n/format";
import { pickTranslation } from "../../../core/i18n/localized-text";
import { isNegative, toApproxNumber } from "../../../core/money/money";
import {
  AmountText,
  Body,
  Content,
  InlineText,
  Label,
  Page,
  PageScroll,
  PageState,
  PrimaryButton,
  Row,
  ScreenHeader,
  SecondaryButton,
  SectionTitle,
  Switch,
  SkeletonBlock,
  Stack,
  Tabs,
  toast,
} from "../../../design-system";
import { useSession } from "../../session/hooks/use-session";
import { requestAuth } from "../../session/model/auth-sheet-store";
import { EVENTS } from "../fixtures/events";
import {
  useCancelOrder,
  useOpenOrders,
  usePositions,
  usePredictActivity,
  usePredictBalance,
  useRedeem,
} from "../hooks/use-predict";
import type {
  Market,
  Order,
  Outcome,
  Position,
  PredictEvent,
} from "../model/predict";
import { OrderSheet, type OrderSheetHandle } from "./order-sheet";
import { StatusBadge, closesText, fill, outcomeLabel } from "./shared";

function findMarket(
  marketId: string,
): { event: PredictEvent; market: Market } | undefined {
  for (const event of EVENTS) {
    const market = event.markets.find((item) => item.id === marketId);
    if (market) return { event, market };
  }
  return undefined;
}

/** P-05 持仓：汇总卡 + 持仓 / 挂单 / 历史。双模块时从预测页进入（有返回键），仅 Predict 时是一级页。 */
export function PositionsScreen({
  onBack,
  onOpenEvent,
  onOpenSettlement,
  onOpenTransfer,
}: {
  onBack?: () => void;
  onOpenEvent: (eventId: string, marketId: string) => void;
  onOpenSettlement: (marketId: string) => void;
  onOpenTransfer: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const session = useSession();
  const address = session.data?.address;
  const balance = usePredictBalance(address);
  const positions = usePositions(address, true);
  const orders = useOpenOrders(address);
  const activity = usePredictActivity(address);
  const redeem = useRedeem(address);
  const cancel = useCancelOrder(address);
  const [tab, setTab] = useState<"positions" | "orders" | "history">(
    "positions",
  );
  const [hideZero, setHideZero] = useState(true);
  const orderSheet = useRef<OrderSheetHandle>(null);

  const header = onBack ? (
    <ScreenHeader
      title={t("predict.positions.title")}
      onBack={onBack}
      backLabel={t("action.back")}
    />
  ) : (
    <SectionTitle fontSize={20} paddingVertical="$2">
      {t("predict.positions.title")}
    </SectionTitle>
  );

  if (!session.isLoading && !address) {
    return (
      <Page>
        <Content paddingTop={insets.top + 8} flex={1}>
          {header}
          <PageState
            title={t("predict.positions.empty")}
            action={
              <PrimaryButton
                onPress={() =>
                  requestAuth({ type: "open_tab", tab: "positions" })
                }
              >
                {t("home.connectWallet")}
              </PrimaryButton>
            }
          />
        </Content>
      </Page>
    );
  }

  const rows = (positions.data ?? []).filter(
    (item) =>
      !hideZero ||
      (!item.closed &&
        !(item.status === "settled" && item.settledPayoutCents === 0)) ||
      item.redeemable,
  );
  const open = (positions.data ?? []).filter((item) => !item.closed);
  const totalPnl = open.reduce(
    (sum, item) => sum + toApproxNumber(item.pnl),
    0,
  );
  const totalCost = open.reduce(
    (sum, item) => sum + toApproxNumber(item.costBasis),
    0,
  );
  const claimable = balance.data?.claimable;
  const redeemableIds = (positions.data ?? [])
    .filter((item) => item.redeemable)
    .map((item) => item.id);

  const claimAll = () => {
    redeem.mutate(redeemableIds, {
      onSuccess: () =>
        toast(
          fill(t("predict.positions.claimed"), {
            amount: claimable ? formatMoney(claimable, locale) : "",
          }),
          "success",
        ),
      onError: () => toast(t("state.error"), "error"),
    });
  };

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        {header}
      </Content>
      <PageScroll
        refresh={{
          refreshing: positions.isRefetching,
          onRefresh: () =>
            void Promise.all([
              positions.refetch(),
              balance.refetch(),
              orders.refetch(),
            ]),
          accessibilityLabel: t("action.refresh"),
        }}
      >
        <Content paddingTop="$1" gap="$3">
          <Stack
            padding="$3"
            borderRadius="$4"
            backgroundColor="$surface"
            gap="$2"
            borderWidth={1}
            borderColor="$borderColor"
          >
            <Row justifyContent="space-between" alignItems="center">
              <Label>{t("predict.positions.value")}</Label>
              <Body fontSize={12}>
                {fill(t("predict.order.available"), {
                  amount: balance.data
                    ? formatMoney(balance.data.available, locale)
                    : "—",
                })}
              </Body>
            </Row>
            {balance.data ? (
              <AmountText fontSize={30} lineHeight={36}>
                {formatUsd(toApproxNumber(balance.data.positionsValue), locale)}
              </AmountText>
            ) : (
              <SkeletonBlock height={36} width={160} />
            )}
            <Row gap="$4">
              <Stack>
                <Body fontSize={11}>{t("predict.positions.totalPnl")}</Body>
                <InlineText
                  fontWeight="800"
                  color={totalPnl >= 0 ? "$pricePositive" : "$priceNegative"}
                >
                  {formatUsd(totalPnl, locale, { sign: true })} (
                  {totalCost > 0
                    ? `${totalPnl >= 0 ? "+" : ""}${((totalPnl / totalCost) * 100).toFixed(1)}%`
                    : "0%"}
                  )
                </InlineText>
              </Stack>
              <Stack>
                <Body fontSize={11}>{t("predict.today")}</Body>
                <InlineText fontWeight="800" color="$pricePositive">
                  {formatUsd(41.2, locale, { sign: true })}
                </InlineText>
              </Stack>
            </Row>
            {claimable &&
            !isNegative(claimable) &&
            BigInt(claimable.raw) > 0n ? (
              <Row
                alignItems="center"
                justifyContent="space-between"
                padding="$2.5"
                borderRadius="$3"
                backgroundColor="$primary"
              >
                <Stack>
                  <Body fontSize={11} color="$onPrimary" opacity={0.85}>
                    {t("predict.positions.claimable")}
                  </Body>
                  <InlineText fontWeight="900" color="$onPrimary">
                    {formatMoney(claimable, locale)}
                  </InlineText>
                </Stack>
                <SecondaryButton
                  height={34}
                  backgroundColor="$onPrimary"
                  color="$primary"
                  borderWidth={0}
                  disabled={redeem.isPending}
                  onPress={claimAll}
                  testID="positions-claim"
                >
                  {t("predict.positions.claim")}
                </SecondaryButton>
              </Row>
            ) : null}
            <Row gap="$2">
              <SecondaryButton
                flex={1}
                height={36}
                onPress={() => toast(t("state.empty"), "info")}
              >
                {t("assets.splitMerge")}
              </SecondaryButton>
              <SecondaryButton flex={1} height={36} onPress={onOpenTransfer}>
                {t("assets.transferAction")}
              </SecondaryButton>
            </Row>
          </Stack>

          <Tabs
            value={tab}
            options={[
              {
                value: "positions",
                label: t("predict.positions.tab.positions"),
                badge: rows.length,
              },
              {
                value: "orders",
                label: t("predict.positions.tab.orders"),
                badge: orders.data?.length,
              },
              { value: "history", label: t("predict.positions.tab.history") },
            ]}
            onChange={setTab}
            accessibilityLabel={t("predict.positions.title")}
          />

          {tab === "positions" ? (
            <>
              <Row justifyContent="space-between" alignItems="center">
                <Body fontSize={12}>
                  {t("predict.positions.allMarkets")} ·{" "}
                  {t("predict.positions.byValue")}
                </Body>
                <Row alignItems="center" gap="$2">
                  <Body fontSize={12}>{t("predict.positions.hideZero")}</Body>
                  <Switch
                    value={hideZero}
                    onValueChange={setHideZero}
                    accessibilityLabel={t("predict.positions.hideZero")}
                  />
                </Row>
              </Row>
              {positions.data ? (
                rows.length === 0 ? (
                  <Body>{t("predict.positions.empty")}</Body>
                ) : (
                  rows.map((position) => (
                    <PositionRow
                      key={position.id}
                      position={position}
                      locale={locale}
                      onOpen={onOpenEvent}
                      onSell={(market, outcome) =>
                        orderSheet.current?.open(market, outcome, "sell")
                      }
                      onSettlement={onOpenSettlement}
                      onClaim={() => redeem.mutate([position.id])}
                    />
                  ))
                )
              ) : (
                <Stack gap="$2">
                  <SkeletonBlock height={96} />
                  <SkeletonBlock height={96} />
                </Stack>
              )}
            </>
          ) : tab === "orders" ? (
            orders.data ? (
              orders.data.length === 0 ? (
                <Body>{t("state.empty")}</Body>
              ) : (
                orders.data.map((order) => (
                  <OrderRow
                    key={order.id}
                    order={order}
                    locale={locale}
                    onCancel={() =>
                      cancel.mutate(order.id, {
                        onSuccess: () =>
                          toast(t("predict.positions.cancelled"), "success"),
                      })
                    }
                  />
                ))
              )
            ) : (
              <SkeletonBlock height={72} />
            )
          ) : activity.data ? (
            activity.data.length === 0 ? (
              <Body>{t("state.empty")}</Body>
            ) : (
              activity.data.map((item) => (
                <Row
                  key={item.id}
                  alignItems="center"
                  gap="$3"
                  paddingVertical="$2.5"
                  borderBottomWidth={1}
                  borderColor="$borderColor"
                >
                  <Stack flex={1} gap="$0.5">
                    <SectionTitle fontSize={14}>
                      {pickTranslation(item.title, locale)}
                    </SectionTitle>
                    {item.eventId ? (
                      <Body fontSize={12} numberOfLines={1}>
                        {pickTranslation(
                          EVENTS.find((event) => event.id === item.eventId)
                            ?.title,
                          locale,
                        )}
                      </Body>
                    ) : null}
                    <Body fontSize={11}>{formatDateTime(item.at, locale)}</Body>
                  </Stack>
                  <InlineText
                    fontWeight="800"
                    color={
                      isNegative(item.amount) ? "$color" : "$pricePositive"
                    }
                  >
                    {isNegative(item.amount) ? "−" : "+"}
                    {formatMoney(
                      { ...item.amount, raw: item.amount.raw.replace("-", "") },
                      locale,
                    )}
                  </InlineText>
                </Row>
              ))
            )
          ) : (
            <SkeletonBlock height={72} />
          )}
        </Content>
      </PageScroll>
      <OrderSheet
        ref={orderSheet}
        event={undefined}
        feeBps={20}
        onInsufficient={() => onOpenTransfer()}
      />
    </Page>
  );
}

function PositionRow({
  position,
  locale,
  onOpen,
  onSell,
  onSettlement,
  onClaim,
}: {
  position: Position;
  locale: string;
  onOpen: (eventId: string, marketId: string) => void;
  onSell: (market: Market, outcome: Outcome) => void;
  onSettlement: (marketId: string) => void;
  onClaim: () => void;
}) {
  const { t } = useFoundationRuntime();
  const found = findMarket(position.marketId);
  if (!found) return null;
  const { event, market } = found;
  const title = market.outcomeLabel
    ? `${pickTranslation(event.title, locale)} — ${pickTranslation(market.outcomeLabel, locale)}`
    : pickTranslation(event.title, locale);
  const disputed =
    position.status === "disputed" || position.status === "arbitrating";
  const pnlColor =
    toApproxNumber(position.pnl) >= 0 ? "$pricePositive" : "$priceNegative";
  return (
    <Stack
      padding="$3"
      borderRadius="$4"
      backgroundColor="$surfaceVariant"
      gap="$2"
      onPress={() => onOpen(event.id, market.id)}
      accessibilityRole="button"
      testID={`position-${position.id}`}
    >
      <Row justifyContent="space-between" alignItems="center">
        <Row alignItems="center" gap="$2">
          {position.redeemable ? (
            <StatusBadge status="settled" />
          ) : disputed ? (
            <StatusBadge status={position.status} />
          ) : (
            <Body fontSize={11}>
              {event.categoryTagId.toUpperCase()} ·{" "}
              {closesText(event.endsAt, locale, t)}
            </Body>
          )}
          {position.redeemable ? (
            <InlineText fontSize={11} fontWeight="800" color="$success">
              {t("predict.positions.youWon")}
            </InlineText>
          ) : null}
        </Row>
      </Row>
      <SectionTitle fontSize={14} numberOfLines={2}>
        {title}
      </SectionTitle>
      <Row alignItems="center" justifyContent="space-between" gap="$2">
        <Stack flex={1}>
          <Row gap="$1.5" alignItems="center">
            <InlineText
              fontWeight="800"
              color={position.outcome === "yes" ? "$success" : "$danger"}
            >
              {outcomeLabel(position.outcome)}
            </InlineText>
            <Body fontSize={12}>
              {fill(t("predict.positions.shares"), { n: position.shares })} ·{" "}
              {position.status === "trading"
                ? fill(t("predict.positions.avgTo"), {
                    from: formatCents(position.avgPriceCents),
                    to: formatCents(position.curPriceCents),
                  })
                : fill(t("predict.positions.avg"), {
                    price: formatCents(position.avgPriceCents),
                  })}
            </Body>
          </Row>
          {disputed ? (
            <Body fontSize={12} color="$warning">
              {t("predict.positions.settlementPaused")}
            </Body>
          ) : (
            <Row gap="$2">
              <InlineText fontWeight="800">
                {formatMoney(position.value, locale)}
              </InlineText>
              {position.status === "trading" ? (
                <InlineText fontSize={12} fontWeight="700" color={pnlColor}>
                  {formatUsd(toApproxNumber(position.pnl), locale, {
                    sign: true,
                  })}{" "}
                  ({position.pnlPct >= 0 ? "+" : ""}
                  {position.pnlPct.toFixed(1)}%)
                </InlineText>
              ) : null}
            </Row>
          )}
        </Stack>
        {position.redeemable ? (
          <PrimaryButton
            height={34}
            paddingHorizontal="$3"
            fontSize={13}
            onPress={onClaim}
            testID={`claim-${position.id}`}
          >
            {t("predict.positions.claim")}
          </PrimaryButton>
        ) : disputed || position.status !== "trading" ? (
          <SecondaryButton
            height={34}
            paddingHorizontal="$3"
            fontSize={13}
            onPress={() => onSettlement(market.id)}
          >
            {t("predict.positions.progress")}
          </SecondaryButton>
        ) : (
          <SecondaryButton
            height={34}
            paddingHorizontal="$3"
            fontSize={13}
            onPress={() => onSell(market, position.outcome)}
            testID={`sell-${position.id}`}
          >
            {t("predict.sell")}
          </SecondaryButton>
        )}
      </Row>
    </Stack>
  );
}

function OrderRow({
  order,
  locale,
  onCancel,
}: {
  order: Order;
  locale: string;
  onCancel: () => void;
}) {
  const { t } = useFoundationRuntime();
  const found = findMarket(order.marketId);
  return (
    <Row
      alignItems="center"
      gap="$3"
      paddingVertical="$2.5"
      borderBottomWidth={1}
      borderColor="$borderColor"
    >
      <Stack flex={1} gap="$0.5">
        <SectionTitle fontSize={14} numberOfLines={1}>
          {found
            ? pickTranslation(
                found.market.outcomeLabel ?? found.event.title,
                locale,
              )
            : order.marketId}
        </SectionTitle>
        <Body fontSize={12}>
          {fill(t("predict.positions.orderRow"), {
            side: order.side === "buy" ? t("predict.buy") : t("predict.sell"),
            outcome: outcomeLabel(order.outcome),
            shares: order.shares,
            price: formatCents(order.priceCents),
          })}
        </Body>
        <Body fontSize={11}>
          {order.tif}
          {order.expiresAt
            ? ` · ${formatDateTime(order.expiresAt, locale)}`
            : ""}{" "}
          ·{" "}
          {fill(t("predict.positions.filled"), {
            filled: order.filledShares,
            total: order.shares,
          })}
        </Body>
      </Stack>
      <SecondaryButton
        height={32}
        paddingHorizontal="$3"
        fontSize={12}
        onPress={onCancel}
        testID={`cancel-${order.id}`}
      >
        {t("predict.positions.cancel")}
      </SecondaryButton>
    </Row>
  );
}
