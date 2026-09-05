import { usePredictAccountBalance } from "../hooks/use-predict-account";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { formatCents, formatMoney, NO_QUOTE } from "../../../core/i18n/format";
import { pickTranslation } from "../../../core/i18n/localized-text";
import {
  compare,
  fromDecimal,
  isZero,
  toDecimalString,
} from "../../../core/money/money";
import {
  AmountInput,
  AppIcon,
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
  useFeeBps,
  useOrderBook,
  useOrderPreview,
  usePlaceOrder,
  usePositions,
  usePredictEvent,
} from "../hooks/use-predict";
import type {
  Market,
  OrderSide,
  OrderType,
  Outcome,
  PlaceOrderRequest,
  PredictEvent,
} from "../model/predict";
import { fill, outcomeLabel } from "./shared";
import { useRequireVerification } from "../../security/use-require-verification";

// 平台市价买入的最小金额（match_dispatcher.go validateOrderAmounts：makerAmount ≥ 1 USDC）
const MIN_MARKET_BUY = fromDecimal("1", 6, "USDW");
/** 市价买入的快捷加额（网页版 BUY_QUICK_AMOUNTS，USDW） */
const BUY_QUICK_ADDS = [2, 20, 100];
/** 限价买入份数的快捷增减（网页版 [-100, -10, +10, +100]） */
const LIMIT_SHARE_STEPS = [-10, 10, 100];
/** 卖出份数比例（网页版 SELL_QUICK_PCTS + Max） */
const SELL_PRESETS = [25, 50, 100];
/**
 * 限价单有效期：撤单前（GTC）或 5 分钟 / 1 小时 / 12 小时后过期（GTD）。
 * 与网页版 `orderExpiry.ts` 一致：GTD 至少 120 秒。
 */
type ExpiryPreset = "never" | "5m" | "1h" | "12h";
const EXPIRY_SECONDS: Record<ExpiryPreset, number> = {
  never: 0,
  "5m": 5 * 60,
  "1h": 60 * 60,
  "12h": 12 * 60 * 60,
};

export type OrderSheetHandle = {
  open: (
    market: Market,
    outcome: Outcome,
    side?: OrderSide,
    /** 从盘口点档位进来：直接切限价并预填这个价 */
    limitPriceCents?: number,
  ) => void;
  dismiss: () => void;
};

const mirror = (cents: number) => Math.round((100 - cents) * 10) / 10;

/**
 * P-03 下单面板：买入 / 卖出 segmented，市价 / 限价切换，Yes/No 选择器；
 * 市价买入输入金额派生份额；限价输入价格 + 份额派生金额；卖出输入份额派生回款。
 * Yes/No 卡上的价格按方向取盘口（买入看卖一、卖出看买一，同网页版 resolveTradePrice）；
 * 限价默认跟随卖一，用户一改就不再跟随；限价可按 tick 步进。
 * 未登录 → 记录意图并拉起登录 sheet，登录后自动重开。
 */
export const OrderSheet = forwardRef<
  OrderSheetHandle,
  {
    event: PredictEvent | undefined;
    onInsufficient: (amount: string) => void;
  }
>(function OrderSheet({ event, onInsufficient }, ref) {
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
  /** market = 跟随盘口自动填；user = 用户改过，不再覆盖 */
  const [priceSource, setPriceSource] = useState<"market" | "user">("market");
  const [expiry, setExpiry] = useState<ExpiryPreset>("never");

  const balance = usePredictAccountBalance(address);
  const positions = usePositions(address);
  const book = useOrderBook(market?.id);
  // 费率按代币从 clob 读（/fee-rate），标签与预览里的手续费金额同源
  const fee = useFeeBps(market?.id);
  const place = usePlaceOrder(address);
  const consumeIntent = useAuthSheet((state) => state.consumeIntent);

  const reset = (
    nextMarket: Market,
    nextOutcome: Outcome,
    nextSide: OrderSide,
    limitPriceCents?: number,
  ) => {
    setMarket(nextMarket);
    setOutcome(nextOutcome);
    setSide(nextSide);
    setType(limitPriceCents !== undefined ? "limit" : "market");
    setAmountText("");
    setSharesText("");
    setExpiry("never");
    if (limitPriceCents !== undefined) {
      setPriceText(String(limitPriceCents));
      setPriceSource("user");
    } else {
      setPriceText("");
      setPriceSource("market");
    }
  };

  useImperativeHandle(ref, () => ({
    open: (nextMarket, nextOutcome, nextSide = "buy", limitPriceCents) => {
      if (!address) {
        requestAuth({
          type: "open_order",
          marketId: nextMarket.id,
          outcome: nextOutcome,
        });
        return;
      }
      reset(nextMarket, nextOutcome, nextSide, limitPriceCents);
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
      reset(target, fulfilled.outcome, "buy");
      sheet.current?.present();
    }, 350);
    return () => clearTimeout(timer);
  }, [address, consumeIntent, event, fulfilled]);

  // 从持仓等入口打开时传进来的 market 是打开那一刻的快照，这里以实时事件价格为准
  const liveEvent = usePredictEvent(market?.eventId);
  // 价格来源顺序同网页版：实时事件价 → 打开时的市场价 → 订单簿 mid / 单边；都没有就是无报价，不编数
  const bestBid = book.data?.bids[0]?.priceCents;
  const bestAsk = book.data?.asks[0]?.priceCents;
  const bookYes =
    bestBid !== undefined && bestAsk !== undefined
      ? Math.round(((bestBid + bestAsk) / 2) * 10) / 10
      : (bestAsk ?? bestBid ?? null);
  const yes: number | null =
    liveEvent.data?.markets.find((item) => item.id === market?.id)
      ?.yesPriceCents ??
    market?.yesPriceCents ??
    bookYes;
  const marketPrice = yes === null ? null : outcome === "yes" ? yes : 100 - yes;
  // 订单簿是 YES 代币的；No 侧盘口取镜像（买 No @ p 等价于卖 Yes @ 100 − p）
  const sideBid =
    bestBid === undefined || bestAsk === undefined
      ? undefined
      : outcome === "yes"
        ? bestBid
        : mirror(bestAsk);
  const sideAsk =
    bestBid === undefined || bestAsk === undefined
      ? undefined
      : outcome === "yes"
        ? bestAsk
        : mirror(bestBid);
  /** 某一结果按当前方向可成交的价：买入看卖一、卖出看买一；簿没到就用展示价 */
  const tradePrice = (option: Outcome): number | null => {
    if (bestBid !== undefined && bestAsk !== undefined) {
      const bid = option === "yes" ? bestBid : mirror(bestAsk);
      const ask = option === "yes" ? bestAsk : mirror(bestBid);
      return side === "buy" ? ask : bid;
    }
    return yes === null ? null : option === "yes" ? yes : 100 - yes;
  };
  // 限价只认用户输入；平台要求价格落在 tick 网格上且在 [tick, 100 − tick] 内（ORDER_PRICE_NOT_ALIGNED）
  const tick = book.data?.tickCents ?? null;
  const typedPrice = Number(priceText);
  const limitPrice =
    priceText !== "" && Number.isFinite(typedPrice) && typedPrice > 0
      ? typedPrice
      : null;
  const offTick =
    limitPrice !== null &&
    tick !== null &&
    (limitPrice < tick ||
      limitPrice > 100 - tick ||
      Math.abs(limitPrice / tick - Math.round(limitPrice / tick)) > 1e-6);

  // 限价跟随盘口：用户没改过时，卖一变了就跟着变（网页版 limitPriceSource === 'market'）
  const followPrice = sideAsk ?? marketPrice;
  useEffect(() => {
    if (type !== "limit" || priceSource !== "market") return;
    setPriceText(followPrice === null ? "" : String(followPrice));
  }, [followPrice, priceSource, type]);

  const stepPrice = (direction: 1 | -1) => {
    const step = tick ?? 1;
    const base = limitPrice ?? followPrice ?? 50;
    const next = Math.round((base + direction * step) / step) * step;
    const clamped = Math.min(100 - step, Math.max(step, next));
    setPriceText(String(Math.round(clamped * 10) / 10));
    setPriceSource("user");
  };

  const held =
    positions.data?.find(
      (item) =>
        item.marketId === market?.id &&
        item.outcome === outcome &&
        item.status === "trading",
    )?.shares ?? 0;
  const shares = Number(sharesText) || 0;
  // 预测账户内的金额单位是 USDW（抵押品），与账户余额同单位
  const amount = fromDecimal(amountText || "0", 6, "USDW");
  const expiresAt =
    type === "limit" && expiry !== "never"
      ? new Date(Date.now() + EXPIRY_SECONDS[expiry] * 1000).toISOString()
      : undefined;
  const request: PlaceOrderRequest | null = market
    ? side === "sell"
      ? { marketId: market.id, outcome, side, type: "market", shares }
      : type === "market"
        ? { marketId: market.id, outcome, side, type, amount }
        : limitPrice === null
          ? null
          : {
              marketId: market.id,
              outcome,
              side,
              type,
              shares,
              priceCents: limitPrice,
              tif: expiresAt ? "GTD" : "GTC",
              expiresAt,
            }
    : null;
  const active =
    request &&
    (side === "sell"
      ? shares > 0
      : type === "market"
        ? !isZero(amount)
        : shares > 0 && !offTick);
  const preview = useOrderPreview(address, active ? request : null);
  const available = balance.data?.available;
  const insufficient =
    side === "buy" && preview.data && available
      ? compare(preview.data.cost, available) > 0
      : false;
  const insufficientShares = side === "sell" && shares > held;
  // 平台校验（match_dispatcher.go validateOrderAmounts）：限价单份数 ≥ /book 的 min_order_size；
  // 市价买入金额 ≥ 1 USDW；市价卖出份数 ≥ 0.01（这里份数输入是整数，天然满足）
  const minShares = book.data?.minOrderShares ?? null;
  const belowMin =
    type === "limit" &&
    side === "buy" &&
    minShares !== null &&
    shares > 0 &&
    shares < minShares;
  // 预览会按当前对手价把下限精确到"份数对齐后仍 ≥ 1 USDC"的金额（常是 1.01 左右）
  const minAmount = preview.data?.minAmount ?? MIN_MARKET_BUY;
  const belowMinAmount =
    side === "buy" &&
    type === "market" &&
    !isZero(amount) &&
    compare(amount, minAmount) < 0;
  const canSubmit = Boolean(
    active &&
    preview.data &&
    !insufficient &&
    !insufficientShares &&
    !belowMin &&
    !belowMinAmount &&
    !place.isPending,
  );

  const submit = async () => {
    if (!request || !market) return;
    if (!(await requireVerification())) return;
    place.mutate(request, {
      onSuccess: (result) => {
        // 市价单一份都没吃到（平台已撤）：留在面板上让用户改价 / 改量，不能说"已提交"
        if (result.status === "canceled") {
          toast(t("predict.order.unfilled"), "error");
          return;
        }
        sheet.current?.dismiss();
        toast(
          result.status !== "filled"
            ? t("predict.order.placed")
            : result.avgPriceCents === null
              ? fill(t("predict.order.filledShares"), {
                  shares: result.filledShares,
                })
              : fill(t("predict.order.filled"), {
                  shares: result.filledShares,
                  price: formatCents(result.avgPriceCents),
                }),
          "success",
        );
      },
      // 平台的拒单原因（errorMsg）直接给用户看，不一律糊成"出错了"
      onError: (error) =>
        toast(
          /closed/i.test(error.message)
            ? t("predict.order.closed")
            : error.message || t("state.error"),
          "error",
        ),
    });
  };

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
            amount: isZero(amount) ? "USDW" : formatMoney(amount, locale),
          })
        : fill(t("predict.order.submitLimit"), {
            outcome: outcomeLabel(outcome),
            shares,
            price: formatCents(limitPrice),
          });
  const availableNumber = available ? Number(toDecimalString(available)) : null;
  const addAmount = (delta: number) =>
    setAmountText(
      (Math.round(((Number(amountText) || 0) + delta) * 100) / 100).toFixed(2),
    );
  const addShares = (delta: number) =>
    setSharesText(String(Math.max(0, shares + delta)));

  return (
    <Sheet
      ref={sheet}
      title={
        market && event
          ? pickTranslation(market.outcomeLabel ?? event.title, locale)
          : market
            ? pickTranslation(market.question, locale)
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
            testID="order-side"
          />
        </Stack>
        {side === "buy" ? (
          <Stack width={132}>
            <SegmentedControl
              size="sm"
              value={type}
              options={[
                { value: "market", label: t("predict.order.market") },
                { value: "limit", label: t("predict.order.limit") },
              ]}
              onChange={(next) => {
                setType(next);
                if (next === "limit") setPriceSource("market");
              }}
              accessibilityLabel={t("predict.order.market")}
              testID="order-type"
            />
          </Stack>
        ) : null}
      </Row>

      <Row gap="$2">
        {(["yes", "no"] as const).map((option) => {
          const selected = outcome === option;
          const price = tradePrice(option);
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
              onPress={() => {
                setOutcome(option);
                setPriceSource("market");
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              testID={`order-outcome-${option}`}
            >
              <Row justifyContent="space-between" alignItems="center">
                <InlineText
                  fontWeight="800"
                  color={option === "yes" ? "$success" : "$danger"}
                >
                  {outcomeLabel(option)}
                </InlineText>
                <Body fontSize={10}>
                  {bestBid !== undefined && bestAsk !== undefined
                    ? side === "buy"
                      ? t("predict.order.buyPrice")
                      : t("predict.order.sellPrice")
                    : ""}
                </Body>
              </Row>
              <InlineText fontSize={20} fontWeight="900">
                {formatCents(price)}
              </InlineText>
            </Stack>
          );
        })}
      </Row>

      {side === "buy" && type === "limit" ? (
        <Stack gap="$1">
          <TextField
            value={priceText}
            onChangeText={(text) => {
              setPriceText(text.replace(/[^\d.]/g, ""));
              setPriceSource("user");
            }}
            keyboardType="decimal-pad"
            placeholder={marketPrice === null ? "" : String(marketPrice)}
            error={
              offTick && tick !== null
                ? fill(t("predict.order.tickHint"), { tick })
                : undefined
            }
            accessibilityLabel={t("predict.order.limitPrice")}
            testID="order-limit-price"
            leading={
              <Row alignItems="center" gap="$2">
                <Stack
                  width={28}
                  height={28}
                  borderRadius={14}
                  backgroundColor="$surface"
                  alignItems="center"
                  justifyContent="center"
                  onPress={() => stepPrice(-1)}
                  accessibilityRole="button"
                  accessibilityLabel={t("predict.order.priceDown")}
                  testID="order-price-down"
                  pressStyle={{ opacity: 0.7 }}
                >
                  <AppIcon name="minus" size={16} colorToken="color" />
                </Stack>
                <Body fontSize={12}>{t("predict.order.limitPrice")}</Body>
              </Row>
            }
            trailing={
              <Row alignItems="center" gap="$2">
                <Body fontSize={11}>
                  {sideBid !== undefined && sideAsk !== undefined
                    ? fill(t("predict.order.bookHint"), {
                        bid: sideBid,
                        ask: sideAsk,
                      })
                    : ""}
                </Body>
                <Stack
                  width={28}
                  height={28}
                  borderRadius={14}
                  backgroundColor="$surface"
                  alignItems="center"
                  justifyContent="center"
                  onPress={() => stepPrice(1)}
                  accessibilityRole="button"
                  accessibilityLabel={t("predict.order.priceUp")}
                  testID="order-price-up"
                  pressStyle={{ opacity: 0.7 }}
                >
                  <AppIcon name="plus" size={16} colorToken="color" />
                </Stack>
              </Row>
            }
          />
          {priceSource === "market" && priceText !== "" ? (
            <Body fontSize={11}>{t("predict.order.priceFollow")}</Body>
          ) : null}
        </Stack>
      ) : null}

      {side === "buy" && type === "market" ? (
        <AmountInput
          value={amountText}
          onChangeText={setAmountText}
          symbol="USDW"
          decimals={2}
          helper={fill(t("predict.order.available"), {
            amount: available ? formatMoney(available, locale) : "—",
          })}
          error={
            insufficient
              ? t("predict.order.insufficient")
              : belowMinAmount
                ? fill(t("predict.order.minAmount"), {
                    amount: formatMoney(minAmount, locale),
                  })
                : undefined
          }
          onMax={() =>
            available && setAmountText(toDecimalString(available, 2))
          }
          maxLabel={t("common.max")}
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
              : [
                  fill(t("predict.order.available"), {
                    amount: available ? formatMoney(available, locale) : "—",
                  }),
                  minShares !== null
                    ? fill(t("predict.order.minSharesHint"), { n: minShares })
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")
          }
          error={
            insufficientShares
              ? t("predict.order.insufficientShares")
              : insufficient
                ? t("predict.order.insufficient")
                : belowMin && minShares !== null
                  ? fill(t("predict.order.minShares"), { n: minShares })
                  : undefined
          }
          onMax={() =>
            side === "sell"
              ? setSharesText(String(Math.floor(held)))
              : availableNumber !== null &&
                limitPrice !== null &&
                setSharesText(
                  String(Math.floor((availableNumber * 100) / limitPrice)),
                )
          }
          maxLabel={t("common.max")}
          presets={side === "sell" ? SELL_PRESETS : undefined}
          onPreset={(pct) =>
            setSharesText(String(Math.floor((held * pct) / 100)))
          }
          accessibilityLabel={t("predict.order.shares")}
          testID="order-shares"
        />
      )}
      {side === "buy" ? (
        <Row gap="$2">
          {(type === "market" ? BUY_QUICK_ADDS : LIMIT_SHARE_STEPS).map(
            (step) => (
              <Stack
                key={step}
                flex={1}
                paddingVertical="$1.5"
                borderRadius="$3"
                backgroundColor="$surfaceVariant"
                alignItems="center"
                onPress={() =>
                  type === "market" ? addAmount(step) : addShares(step)
                }
                accessibilityRole="button"
                testID={`order-quick-${step}`}
              >
                <InlineText fontSize={12} fontWeight="700">
                  {step > 0 ? "+" : ""}
                  {step}
                  {type === "market" ? " USDW" : ""}
                </InlineText>
              </Stack>
            ),
          )}
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
                  side === "buy" && type === "limit"
                    ? limitPrice
                    : tradePrice(outcome),
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
            gap="$2"
          >
            <Body fontSize={13}>{t("predict.order.tif")}</Body>
            <Row gap="$1.5" flexWrap="wrap" justifyContent="flex-end">
              {(Object.keys(EXPIRY_SECONDS) as ExpiryPreset[]).map((option) => (
                <Stack
                  key={option}
                  paddingHorizontal="$2"
                  paddingVertical="$1"
                  borderRadius={999}
                  backgroundColor={
                    expiry === option ? "$color" : "$surfaceVariant"
                  }
                  onPress={() => setExpiry(option)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: expiry === option }}
                  testID={`order-expiry-${option}`}
                >
                  <InlineText
                    fontSize={11}
                    fontWeight="700"
                    color={expiry === option ? "$background" : "$color"}
                  >
                    {t(`predict.order.expiry.${option}`)}
                  </InlineText>
                </Stack>
              ))}
            </Row>
          </Row>
        ) : null}
        <DetailRow
          label={fill(t("predict.order.fee"), {
            pct:
              fee.data === undefined
                ? NO_QUOTE
                : `${(fee.data / 100).toFixed(2)}%`,
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
                ? preview.data.potentialReturnPct === null
                  ? formatMoney(preview.data.potentialPayout, locale)
                  : `${formatMoney(preview.data.potentialPayout, locale)} (+${preview.data.potentialReturnPct.toFixed(1)}%)`
                : NO_QUOTE
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
