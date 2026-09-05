import { useMemo } from "react";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { formatCents } from "../../../core/i18n/format";
import {
  Body,
  InlineText,
  Row,
  SegmentedControl,
  SkeletonBlock,
  Stack,
  useTheme,
} from "../../../design-system";
import { deriveBookView, type BookRow } from "../model/order-book-view";
import type { OrderBook, OrderSide, Outcome } from "../model/predict";
import { fill } from "./shared";

const ROW_HEIGHT = 30;

/**
 * 盘口（网页版 based.one 布局）：卖盘在上（红，远→近）、中间一行最新价 / 价差、买盘在下（绿）。
 * 三列：价格 / 数量 / 累计（$）；深度条按累计额铺在行底。Yes / No 切换只换视角，簿还是 YES 簿。
 * 点一档：卖盘按该价挂买单，买盘按该价挂卖单。
 */
export function OrderBookView({
  book,
  outcome,
  onOutcomeChange,
  onPickPrice,
  depth = 5,
}: {
  book: OrderBook | undefined;
  outcome: Outcome;
  onOutcomeChange: (outcome: Outcome) => void;
  onPickPrice?: (priceCents: number, side: OrderSide) => void;
  depth?: number;
}) {
  const { t } = useFoundationRuntime();
  const view = useMemo(
    () => (book ? deriveBookView(book, outcome, depth) : null),
    [book, outcome, depth],
  );
  return (
    <Stack gap="$2" testID="order-book">
      <Row alignItems="center" justifyContent="space-between" gap="$3">
        <Stack width={140}>
          <SegmentedControl
            size="sm"
            value={outcome}
            options={[
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ]}
            onChange={onOutcomeChange}
            accessibilityLabel={t("predict.outcomes")}
            testID="book-outcome"
          />
        </Stack>
        {book ? (
          <Body fontSize={11}>
            {fill(t("predict.book.tick"), {
              tick: formatCents(book.tickCents),
            })}
          </Body>
        ) : null}
      </Row>
      <Row paddingHorizontal="$1">
        <Body fontSize={11} flex={1}>
          {t("predict.book.price")}
        </Body>
        <Body fontSize={11} flex={1} textAlign="center">
          {t("predict.book.shares")}
        </Body>
        <Body fontSize={11} flex={1} textAlign="right">
          {t("predict.book.total")}
        </Body>
      </Row>
      {!view ? (
        <SkeletonBlock height={ROW_HEIGHT * (depth * 2 + 1)} />
      ) : view.asks.length === 0 && view.bids.length === 0 ? (
        <Stack
          height={ROW_HEIGHT * 4}
          alignItems="center"
          justifyContent="center"
        >
          <Body fontSize={12}>{t("predict.book.noOrders")}</Body>
        </Stack>
      ) : (
        <Stack>
          {view.asks.map((row) => (
            <BookLine
              key={`ask-${row.priceCents}`}
              row={row}
              tone="negative"
              onPress={
                onPickPrice
                  ? () => onPickPrice(row.priceCents, "buy")
                  : undefined
              }
              testID={`book-ask-${row.priceCents}`}
            />
          ))}
          <Row
            height={ROW_HEIGHT}
            alignItems="center"
            justifyContent="space-between"
            paddingHorizontal="$1"
            borderTopWidth={1}
            borderBottomWidth={1}
            borderColor="$borderColor"
            testID="book-spread"
          >
            <InlineText fontSize={12} fontWeight="800">
              {t("predict.book.last")} {formatCents(view.lastCents)}
            </InlineText>
            <Body fontSize={11}>
              {fill(t("predict.book.spread"), {
                spread: formatCents(view.spreadCents),
              })}
            </Body>
          </Row>
          {view.bids.map((row) => (
            <BookLine
              key={`bid-${row.priceCents}`}
              row={row}
              tone="positive"
              onPress={
                onPickPrice
                  ? () => onPickPrice(row.priceCents, "sell")
                  : undefined
              }
              testID={`book-bid-${row.priceCents}`}
            />
          ))}
        </Stack>
      )}
      {onPickPrice && view ? (
        <Body fontSize={11}>{t("predict.book.tapHint")}</Body>
      ) : null}
    </Stack>
  );
}

function BookLine({
  row,
  tone,
  onPress,
  testID,
}: {
  row: BookRow;
  tone: "positive" | "negative";
  onPress?: () => void;
  testID: string;
}) {
  const theme = useTheme();
  const color = tone === "positive" ? "$pricePositive" : "$priceNegative";
  const barColor =
    tone === "positive" ? theme.pricePositive.val : theme.priceNegative.val;
  return (
    <Row
      height={ROW_HEIGHT}
      alignItems="center"
      paddingHorizontal="$1"
      position="relative"
      onPress={onPress}
      accessibilityRole={onPress ? "button" : undefined}
      pressStyle={onPress ? { opacity: 0.7 } : undefined}
      testID={testID}
    >
      <Stack
        position="absolute"
        top={2}
        bottom={2}
        left={0}
        width={`${row.barPct}%`}
        borderRadius={3}
        style={{ backgroundColor: `${barColor}22` }}
      />
      <InlineText
        flex={1}
        fontSize={13}
        fontWeight="700"
        color={color}
        fontVariant={["tabular-nums"]}
      >
        {formatCents(row.priceCents)}
      </InlineText>
      <InlineText
        flex={1}
        fontSize={12}
        textAlign="center"
        fontVariant={["tabular-nums"]}
      >
        {row.shares.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </InlineText>
      <Body
        flex={1}
        fontSize={12}
        textAlign="right"
        fontVariant={["tabular-nums"]}
      >
        $
        {row.totalUsd.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </Body>
    </Row>
  );
}
