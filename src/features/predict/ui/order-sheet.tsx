import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { formatCents, formatMoney } from "../../../core/i18n/format";
import { pickTranslation } from "../../../core/i18n/localized-text";
import {
  compare,
  fromDecimal,
  isZero,
  toDecimalString,
} from "../../../core/money/money";
import {
  AmountInput,
  Body,
  DetailRow,
  InlineText,
  PrimaryButton,
  Row,
  SegmentedControl,
  Sheet,
  type SheetHandle,
  Stack,
  TextField,
  toast,
} from "../../../design-system";
import { useSession } from "../../session/hooks/use-session";
import {
  requestAuth,
  useAuthSheet,
} from "../../session/model/auth-sheet-store";
import {
  useOrderBook,
  useOrderPreview,
  usePlaceOrder,
  usePositions,
  usePredictBalance,
  usePredictEvent,
} from "../hooks/use-predict";
import type {
  Market,
  OrderSide,
  OrderType,
  Outcome,
  PlaceOrderRequest,
  PredictEvent,
  TimeInForce,
} from "../model/predict";
import { fill, outcomeLabel } from "./shared";
import { useRequireVerification } from "../../security/use-require-verification";

export type OrderSheetHandle = {
  open: (market: Market, outcome: Outcome, side?: OrderSide) => void;
  dismiss: () => void;
};

/**
 * P-03 下单面板：买入 / 卖出 segmented，市价 / 限价切换，Yes/No 选择器；
 * 市价买入输入金额派生份额；限价输入价格 + 份额派生金额；卖出输入份额派生回款。
 * 未登录 → 记录意图并拉起登录 sheet，登录后自动重开。
 */
export const OrderSheet = forwardRef<
  OrderSheetHandle,
  {
    event: PredictEvent | undefined;
    feeBps: number;
    onInsufficient: (amount: string) => void;
  }
>(function OrderSheet({ event, feeBps, onInsufficient }, ref) {
  const { config, t } = useFoundationRuntime();
  const requireVerification = useRequireVerification();
  const locale = config.localization.selectedLocale;
  const sheet = useRef<SheetHandle>(null);
  const session = useSession();
  const address = session.data?.address;
  const [market, setMarket] = useState<Market | undefined>();
  const [outcome, setOutcome] = useState<Outcome>("yes");
  const [side, setSide] = useState<OrderSide>("buy");
  const [type, setType] = useState<OrderType>("market");
  const [amountText, setAmountText] = useState("");
  const [sharesText, setSharesText] = useState("");
  const [priceText, setPriceText] = useState("");
  const [tif, setTif] = useState<TimeInForce>("GTC");

  const balance = usePredictBalance(address);
  const positions = usePositions(address);
  const book = useOrderBook(market?.id);
  const place = usePlaceOrder(address);
  const consumeIntent = useAuthSheet((state) => state.consumeIntent);

  useImperativeHandle(ref, () => ({
    open: (nextMarket, nextOutcome, nextSide = "buy") => {
      if (!address) {
        requestAuth({
          type: "open_order",
          marketId: nextMarket.id,
          outcome: nextOutcome,
        });
        return;
      }
      setMarket(nextMarket);
      setOutcome(nextOutcome);
      setSide(nextSide);
      setType("market");
      setAmountText("");
      setSharesText("");
      setPriceText(
        String(
          nextOutcome === "yes"
            ? nextMarket.yesPriceCents - 0.5
            : 100 - nextMarket.yesPriceCents - 0.5,
        ),
      );
      sheet.current?.present();
    },
    dismiss: () => sheet.current?.dismiss(),
  }));

  // 登录成功后回放意图（在 effect 中消费，避免渲染期间更新其他组件）
  const fulfilled = useAuthSheet((state) => state.fulfilled);
  useEffect(() => {
    if (fulfilled?.type !== "open_order" || !address || !event) return;
    const target = event.markets.find((item) => item.id === fulfilled.marketId);
    if (!target) return;
    const intent = consumeIntent();
    if (!intent) return;
    const timer = setTimeout(() => {
      setMarket(target);
      setOutcome(fulfilled.outcome);
      setSide("buy");
      sheet.current?.present();
    }, 350);
    return () => clearTimeout(timer);
  }, [address, consumeIntent, event, fulfilled]);

  // 从持仓等入口打开时 market 可能来自静态夹具，这里以实时事件价格为准
  const liveEvent = usePredictEvent(market?.eventId);
  const yes =
    liveEvent.data?.markets.find((item) => item.id === market?.id)
      ?.yesPriceCents ??
    market?.yesPriceCents ??
    50;
  const marketPrice = outcome === "yes" ? yes : 100 - yes;
  const limitPrice = Number(priceText) || marketPrice;
  const held =
    positions.data?.find(
      (item) =>
        item.marketId === market?.id &&
        item.outcome === outcome &&
        item.status === "trading",
    )?.shares ?? 0;
  const shares = Number(sharesText) || 0;
  const amount = fromDecimal(amountText || "0", 6, "USDC");
  const request: PlaceOrderRequest | null = market
    ? side === "sell"
      ? { marketId: market.id, outcome, side, type: "market", shares }
      : type === "market"
        ? { marketId: market.id, outcome, side, type, amount }
        : {
            marketId: market.id,
            outcome,
            side,
            type,
            shares,
            priceCents: limitPrice,
            tif,
          }
    : null;
  const active =
    request &&
    (side === "sell"
      ? shares > 0
      : type === "market"
        ? !isZero(amount)
        : shares > 0);
  const preview = useOrderPreview(address, active ? request : null);
  const available = balance.data?.available;
  const insufficient =
    side === "buy" && preview.data && available
      ? compare(preview.data.cost, available) > 0
      : false;
  const insufficientShares = side === "sell" && shares > held;
  const canSubmit = Boolean(
    active &&
    preview.data &&
    !insufficient &&
    !insufficientShares &&
    !place.isPending,
  );

  const submit = async () => {
    if (!request || !market) return;
    if (!(await requireVerification())) return;
    place.mutate(request, {
      onSuccess: (result) => {
        sheet.current?.dismiss();
        toast(
          result.status === "filled"
            ? fill(t("predict.order.filled"), {
                shares: result.filledShares,
                price: formatCents(result.avgPriceCents),
              })
            : t("predict.order.placed"),
          "success",
        );
      },
      onError: (error) =>
        toast(
          /closed/i.test(error.message)
            ? t("predict.order.closed")
            : t("state.error"),
          "error",
        ),
    });
  };

  const bestBid = book.data?.bids[0]?.priceCents;
  const bestAsk = book.data?.asks[0]?.priceCents;
  const submitLabel = !request
    ? ""
    : side === "sell"
      ? fill(t("predict.order.submitSell"), {
          outcome: outcomeLabel(outcome),
          shares,
        })
      : type === "market"
        ? fill(t("predict.order.submitBuy"), {
            outcome: outcomeLabel(outcome),
            amount: isZero(amount) ? "USDC" : formatMoney(amount, locale),
          })
        : fill(t("predict.order.submitLimit"), {
            outcome: outcomeLabel(outcome),
            shares,
            price: formatCents(limitPrice),
          });

  return (
    <Sheet
      ref={sheet}
      title={
        market && event
          ? pickTranslation(market.outcomeLabel ?? event.title, locale)
          : ""
      }
      subtitle={
        market?.outcomeLabel && event
          ? pickTranslation(event.title, locale)
          : undefined
      }
      closeLabel={t("common.close")}
      scroll
      locked={place.isPending}
      testID="order-sheet"
    >
      <Row alignItems="center" justifyContent="space-between" gap="$3">
        <Stack flex={1}>
          <SegmentedControl
            value={side}
            options={[
              { value: "buy", label: t("predict.buy") },
              { value: "sell", label: t("predict.sell") },
            ]}
            onChange={(next) => {
              setSide(next);
              setSharesText("");
              setAmountText("");
            }}
            accessibilityLabel={t("predict.buy")}
          />
        </Stack>
        {side === "buy" ? (
          <Row borderRadius={999} backgroundColor="$surfaceVariant" padding={2}>
            {(["market", "limit"] as const).map((option) => (
              <Stack
                key={option}
                paddingHorizontal="$2.5"
                paddingVertical="$1"
                borderRadius={999}
                backgroundColor={type === option ? "$surface" : "transparent"}
                onPress={() => setType(option)}
                accessibilityRole="radio"
                accessibilityState={{ selected: type === option }}
                testID={`order-type-${option}`}
              >
                <InlineText
                  fontSize={12}
                  fontWeight="700"
                  color={type === option ? "$color" : "$textMuted"}
                >
                  {t(`predict.order.${option}`)}
                </InlineText>
              </Stack>
            ))}
          </Row>
        ) : null}
      </Row>

      <Row gap="$2">
        {(["yes", "no"] as const).map((option) => {
          const selected = outcome === option;
          const price = option === "yes" ? yes : 100 - yes;
          return (
            <Stack
              key={option}
              flex={1}
              padding="$3"
              borderRadius="$4"
              backgroundColor="$surfaceVariant"
              borderWidth={1.5}
              borderColor={
                selected
                  ? option === "yes"
                    ? "$success"
                    : "$danger"
                  : "transparent"
              }
              onPress={() => setOutcome(option)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              testID={`order-outcome-${option}`}
            >
              <InlineText
                fontWeight="800"
                color={option === "yes" ? "$success" : "$danger"}
              >
                {outcomeLabel(option)}
              </InlineText>
              <InlineText fontSize={20} fontWeight="900">
                {formatCents(price)}
              </InlineText>
            </Stack>
          );
        })}
      </Row>

      {side === "buy" && type === "limit" ? (
        <TextField
          value={priceText}
          onChangeText={(text) => setPriceText(text.replace(/[^\d.]/g, ""))}
          keyboardType="decimal-pad"
          placeholder={String(marketPrice)}
          accessibilityLabel={t("predict.order.limitPrice")}
          testID="order-limit-price"
          leading={<Body fontSize={12}>{t("predict.order.limitPrice")}</Body>}
          trailing={
            <Body fontSize={11}>
              {bestBid !== undefined && bestAsk !== undefined
                ? fill(t("predict.order.bookHint"), {
                    bid: bestBid,
                    ask: bestAsk,
                  })
                : ""}
            </Body>
          }
        />
      ) : null}

      {side === "buy" && type === "market" ? (
        <AmountInput
          value={amountText}
          onChangeText={setAmountText}
          symbol="USDC"
          decimals={2}
          helper={fill(t("predict.order.available"), {
            amount: available ? formatMoney(available, locale) : "—",
          })}
          error={insufficient ? t("predict.order.insufficient") : undefined}
          onMax={() =>
            available && setAmountText(toDecimalString(available, 2))
          }
          maxLabel={t("common.max")}
          presets={[25, 50, 75, 100]}
          onPreset={(pct) =>
            available &&
            setAmountText(
              ((Number(toDecimalString(available)) * pct) / 100).toFixed(2),
            )
          }
          accessibilityLabel={t("predict.order.amount")}
          testID="order-amount"
        />
      ) : (
        <AmountInput
          value={sharesText}
          onChangeText={setSharesText}
          symbol={t("predict.order.shares.unit")}
          decimals={0}
          helper={
            side === "sell"
              ? fill(t("predict.order.holding"), { shares: held })
              : fill(t("predict.order.available"), {
                  amount: available ? formatMoney(available, locale) : "—",
                })
          }
          error={
            insufficientShares
              ? t("predict.order.insufficientShares")
              : insufficient
                ? t("predict.order.insufficient")
                : undefined
          }
          onMax={() =>
            side === "sell"
              ? setSharesText(String(Math.floor(held)))
              : available &&
                setSharesText(
                  String(
                    Math.floor(
                      (Number(toDecimalString(available)) * 100) / limitPrice,
                    ),
                  ),
                )
          }
          maxLabel={t("common.max")}
          presets={side === "sell" ? [25, 50, 75, 100] : undefined}
          onPreset={(pct) =>
            setSharesText(String(Math.floor((held * pct) / 100)))
          }
          accessibilityLabel={t("predict.order.shares")}
          testID="order-shares"
        />
      )}
      {side === "buy" && type === "limit" ? (
        <Row gap="$2">
          {[10, 50, 100].map((step) => (
            <Stack
              key={step}
              flex={1}
              paddingVertical="$1.5"
              borderRadius="$3"
              backgroundColor="$surfaceVariant"
              alignItems="center"
              onPress={() => setSharesText(String(shares + step))}
              accessibilityRole="button"
            >
              <InlineText fontSize={12} fontWeight="700">
                +{step}
              </InlineText>
            </Stack>
          ))}
        </Row>
      ) : null}

      <Stack>
        {side === "buy" && type === "market" ? (
          <DetailRow
            label={t("predict.order.estShares")}
            value={
              preview.data
                ? `${preview.data.estimatedShares} ${t("predict.order.shares.unit")}`
                : "—"
            }
          />
        ) : null}
        <DetailRow
          label={t("predict.order.avgPrice")}
          value={
            preview.data
              ? formatCents(preview.data.avgPriceCents)
              : formatCents(
                  side === "buy" && type === "limit" ? limitPrice : marketPrice,
                )
          }
        />
        <DetailRow
          label={
            side === "sell"
              ? t("predict.order.proceeds")
              : t("predict.order.total")
          }
          value={preview.data ? formatMoney(preview.data.cost, locale) : "—"}
        />
        {side === "buy" && type === "limit" ? (
          <Row
            alignItems="center"
            justifyContent="space-between"
            paddingVertical="$1.5"
          >
            <Body fontSize={13}>{t("predict.order.tif")}</Body>
            <Row gap="$1.5">
              {(["GTC", "GTD"] as const).map((option) => (
                <Stack
                  key={option}
                  paddingHorizontal="$2"
                  paddingVertical="$1"
                  borderRadius={999}
                  backgroundColor={
                    tif === option ? "$primary" : "$surfaceVariant"
                  }
                  onPress={() => setTif(option)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: tif === option }}
                >
                  <InlineText
                    fontSize={11}
                    fontWeight="700"
                    color={tif === option ? "$onPrimary" : "$color"}
                  >
                    {option}
                  </InlineText>
                </Stack>
              ))}
            </Row>
          </Row>
        ) : null}
        <DetailRow
          label={fill(t("predict.order.fee"), {
            pct: `${(feeBps / 100).toFixed(2)}%`,
          })}
          value={preview.data ? formatMoney(preview.data.fee, locale) : "—"}
        />
        {side === "buy" ? (
          <DetailRow
            label={fill(t("predict.order.payout"), {
              outcome: outcomeLabel(outcome),
            })}
            value={
              preview.data
                ? `${formatMoney(preview.data.potentialPayout, locale)} (+${preview.data.potentialReturnPct.toFixed(1)}%)`
                : "—"
            }
            tone="positive"
          />
        ) : null}
      </Stack>

      {insufficient ? (
        <PrimaryButton
          onPress={() => {
            sheet.current?.dismiss();
            onInsufficient(
              preview.data ? toDecimalString(preview.data.cost, 2) : amountText,
            );
          }}
          testID="order-topup"
        >
          {t("predict.topUp")}
        </PrimaryButton>
      ) : (
        <PrimaryButton
          disabled={!canSubmit}
          onPress={() => void submit()}
          backgroundColor={outcome === "yes" ? "$success" : "$danger"}
          testID="order-submit"
        >
          {place.isPending ? t("login.signing") : submitLabel}
        </PrimaryButton>
      )}
      <Body fontSize={11}>
        {type === "market" || side === "sell"
          ? t("predict.order.marketNote")
          : t("predict.order.limitNote")}
      </Body>
    </Sheet>
  );
});
