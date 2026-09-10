import { Image } from "react-native";
import { useNow } from "../../../core/time/use-now";
import { useState } from "react";
import { useFoundationRuntime } from "../../../app/runtime-context";
import {
  formatCents,
  formatCountdown,
  formatDate,
  formatPercentCents,
  formatTimeUntil,
  formatUsd,
  fill,
} from "../../../core/i18n/format";
import { pickTranslation } from "../../../core/i18n/localized-text";
import {
  Badge,
  Body,
  Card,
  IconButton,
  InlineText,
  Row,
  SecondaryButton,
  SectionTitle,
  SkeletonBlock,
  Stack,
} from "../../../design-system";
import { useFavoritesStore, useIsFavorite } from "../model/favorites-store";
import type {
  Market,
  MarketStatus,
  Outcome,
  PredictEvent,
} from "../model/predict";

// 本模块内部也用它；其它屏幕一直从这里取，保持入口不变
export { fill };

const STATUS_TONE: Record<
  MarketStatus,
  "success" | "textMuted" | "warning" | "info"
> = {
  trading: "success",
  awaiting_result: "textMuted",
  result_proposed: "textMuted",
  disputed: "warning",
  arbitrating: "warning",
  settled: "info",
  canceled: "textMuted",
};

export function StatusBadge({ status }: { status: MarketStatus }) {
  const { t } = useFoundationRuntime();
  const tone = STATUS_TONE[status];
  const color =
    tone === "success"
      ? "$success"
      : tone === "warning"
        ? "$warning"
        : tone === "info"
          ? "$info"
          : "$textMuted";
  return (
    <Badge paddingVertical={3}>
      <InlineText fontSize={11} fontWeight="700" color={color}>
        {t(`predict.status.${status}`)}
      </InlineText>
    </Badge>
  );
}

export function outcomeLabel(outcome: Outcome): string {
  return outcome === "yes" ? "Yes" : "No";
}

/** 截止文案：未截止 → "1 天 4 小时后截止"，已截止 → "已于 … 截止"。`now` 由调用方经 useNow 取，渲染期不直接读时钟 */
export function closesText(
  endsAt: string,
  now: number,
  locale: string,
  t: (key: string) => string,
): string {
  const until = formatTimeUntil(endsAt, now, locale);
  if (!until)
    return fill(t("predict.closedAt"), { time: formatDate(endsAt, locale) });
  const days = (new Date(endsAt).getTime() - now) / 86_400_000;
  return days > 7
    ? fill(t("predict.closesAt"), {
        time: formatDate(endsAt, locale) + (locale === "zh-CN" ? "" : " "),
      })
    : fill(t("predict.closesIn"), { time: until });
}

/** Yes/No 双钮（二元卡） */
export function YesNoButtons({
  yes,
  onPress,
  compact,
  disabled = false,
}: {
  yes: number | null;
  onPress: (outcome: Outcome) => void;
  compact?: boolean;
  /** 平台暂停接单：按钮变灰不可点 */
  disabled?: boolean;
}) {
  const { t } = useFoundationRuntime();
  const no = yes === null ? null : 100 - yes;
  return (
    <Row gap="$2" opacity={disabled ? 0.45 : 1}>
      <Stack
        flex={1}
        height={compact ? 34 : 44}
        borderRadius="$3"
        alignItems="center"
        justifyContent="center"
        backgroundColor="$surfaceVariant"
        onPress={disabled ? undefined : () => onPress("yes")}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        accessibilityLabel={`${t("predict.buyYes")} ${formatCents(yes)}`}
        pressStyle={{ opacity: 0.75 }}
      >
        <InlineText
          color="$success"
          fontWeight="800"
          fontSize={compact ? 12 : 14}
        >
          {compact ? "Yes" : t("predict.buyYes")} {formatCents(yes)}
        </InlineText>
      </Stack>
      <Stack
        flex={1}
        height={compact ? 34 : 44}
        borderRadius="$3"
        alignItems="center"
        justifyContent="center"
        backgroundColor="$surfaceVariant"
        onPress={disabled ? undefined : () => onPress("no")}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        accessibilityLabel={`${t("predict.buyNo")} ${formatCents(no)}`}
        pressStyle={{ opacity: 0.75 }}
      >
        <InlineText
          color="$danger"
          fontWeight="800"
          fontSize={compact ? 12 : 14}
        >
          {compact ? "No" : t("predict.buyNo")} {formatCents(no)}
        </InlineText>
      </Stack>
    </Row>
  );
}

/**
 * 事件 / 市场图片：平台给了 URL 才渲染，没给或加载失败都不占位。
 * 隐藏坏图是界面层处理，不替换成别的图，也不影响其它字段。
 *
 * 尺寸两种写法：`size` 是正方形图标；`aspectRatio` 占满容器宽度、按比例定高——高度由
 * 布局算出，不用 JS 先量宽再改高，卡片第一帧就是最终尺寸。下载完成前铺一块同尺寸骨架
 * （与 `BrandMark` 同一套做法）：占位，但不冒充内容。
 */
export function EventImage({
  uri,
  size,
  aspectRatio,
  radius = 8,
  testID,
}: {
  uri: string | null;
  size?: number;
  /** 宽 / 高（海报位 16 / 9）：给了就占满容器宽度，高度由布局按比例算 */
  aspectRatio?: number;
  radius?: number;
  testID?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!uri || failed) return null;
  return (
    <Stack
      width={aspectRatio === undefined ? size : "100%"}
      height={aspectRatio === undefined ? size : undefined}
      aspectRatio={aspectRatio}
    >
      {loaded ? null : (
        <Stack position="absolute" inset={0}>
          <SkeletonBlock flex={1} borderRadius={radius} />
        </Stack>
      )}
      <Image
        source={{ uri }}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
        style={{
          width: "100%",
          height: "100%",
          borderRadius: radius,
          backgroundColor: "transparent",
        }}
        testID={testID}
      />
    </Stack>
  );
}

/** 收藏星标：本机收藏，与网页版一样不上报平台 */
export function FavoriteButton({
  eventId,
  size = 26,
}: {
  eventId: string;
  size?: number;
}) {
  const { t } = useFoundationRuntime();
  const favorite = useIsFavorite(eventId);
  const toggle = useFavoritesStore((state) => state.toggle);
  return (
    <IconButton
      label={t(favorite ? "predict.favorites.remove" : "predict.favorites.add")}
      icon={favorite ? "star" : "star-outline"}
      size={size}
      onPress={() => toggle(eventId)}
      testID={`favorite-${eventId}`}
    />
  );
}

/**
 * 地区限制提示：受限 → 红色横幅；检查失败 / 未回来 → "无法确认所在地区" + 重试；允许 → 不渲染。
 * 详情页用 detail 取更长的说明文案。
 */
export function RegionNotice({
  state,
  onRetry,
  detail = false,
}: {
  state: "allowed" | "restricted" | "unknown";
  onRetry: () => void;
  detail?: boolean;
}) {
  const { t } = useFoundationRuntime();
  if (state === "allowed") return null;
  return (
    <Row
      alignItems="center"
      justifyContent="space-between"
      gap="$2"
      padding="$3"
      borderRadius="$4"
      backgroundColor="$surfaceVariant"
      testID={`region-notice-${state}`}
    >
      <Body color="$danger" flex={1}>
        {state === "restricted"
          ? t(
              detail
                ? "predict.region.restrictedDetail"
                : "predict.region.restricted",
            )
          : t("predict.region.unknown")}
      </Body>
      {state === "unknown" ? (
        <SecondaryButton height={32} onPress={onRetry} testID="region-retry">
          {t("action.retryNow")}
        </SecondaryButton>
      ) : null}
    </Row>
  );
}

/** 已截止 / 已结算市场在卡片上的结果标签，替代买卖按钮 */
export function OutcomeResultBadge({ market }: { market: Market }) {
  const { t } = useFoundationRuntime();
  const label = market.result
    ? fill(t("predict.outcome.won"), { outcome: outcomeLabel(market.result) })
    : market.closed
      ? t("predict.outcome.ended")
      : !market.acceptingOrders
        ? t("predict.outcome.notAccepting")
        : null;
  if (label === null) return null;
  return (
    <Badge paddingVertical={3} testID={`outcome-result-${market.id}`}>
      <InlineText
        fontSize={11}
        fontWeight="700"
        color={market.result ? "$success" : "$textMuted"}
      >
        {label}
      </InlineText>
    </Badge>
  );
}

/**
 * 市场卡：二元（大概率数 + 双钮）/ 多结果（前 3 行小钮）/ 体育三向。
 * 已截止或已结算的市场显示结果标签，不再给买卖按钮。
 */
export function EventCard({
  event,
  onOpen,
  onOrder,
  orderDisabled = false,
}: {
  event: PredictEvent;
  onOpen: (event: PredictEvent, market?: Market) => void;
  onOrder: (market: Market, outcome: Outcome) => void;
  /** 地区限制等外部原因不给下单：按钮禁用但仍显示价格 */
  orderDisabled?: boolean;
}) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const now = useNow();
  const primary = event.markets[0];
  const category = pickTranslation(event.category, locale).toUpperCase();
  const meta = closesText(event.endsAt, now, locale, t);
  return (
    <Card
      padding="$3"
      shadowOpacity={0}
      gap="$2.5"
      onPress={() => onOpen(event)}
      accessibilityRole="button"
      testID={`event-${event.id}`}
    >
      <Row justifyContent="space-between" alignItems="center" gap="$2">
        <Body fontSize={11} flex={1} numberOfLines={1}>
          {category} ·{" "}
          {event.kind === "sports" && event.sports
            ? fill(t("predict.kickoff"), {
                time: formatCountdown(event.sports.startsAt, now).slice(0, 5),
              })
            : meta}
        </Body>
        {event.kind === "multi" ? (
          <Body fontSize={11}>
            {fill(t("predict.outcomes"), { n: event.markets.length })}
          </Body>
        ) : null}
        <FavoriteButton eventId={event.id} size={24} />
      </Row>
      {event.kind === "sports" && event.sports ? (
        <SportsBody event={event} onOrder={onOrder} />
      ) : event.kind === "multi" ? (
        <Stack gap="$2">
          <Row gap="$2" alignItems="flex-start">
            <EventImage
              uri={event.iconUrl}
              size={40}
              testID={`event-icon-${event.id}`}
            />
            <SectionTitle flex={1} numberOfLines={2}>
              {pickTranslation(event.title, locale)}
            </SectionTitle>
          </Row>
          {event.markets.slice(0, 3).map((market) => (
            <Row key={market.id} alignItems="center" gap="$2">
              <Body flex={1} numberOfLines={1} color="$color">
                {pickTranslation(market.outcomeLabel, locale)}
              </Body>
              <InlineText fontWeight="800" width={44} textAlign="right">
                {formatPercentCents(market.yesPriceCents)}
              </InlineText>
              <Stack width={132} alignItems="flex-end">
                {market.closed || market.result || !market.acceptingOrders ? (
                  <OutcomeResultBadge market={market} />
                ) : (
                  <YesNoButtons
                    yes={market.yesPriceCents}
                    compact
                    disabled={!market.acceptingOrders || orderDisabled}
                    onPress={(outcome) => onOrder(market, outcome)}
                  />
                )}
              </Stack>
            </Row>
          ))}
        </Stack>
      ) : primary ? (
        <Stack gap="$2">
          <Row alignItems="center" gap="$3">
            <EventImage
              uri={event.iconUrl}
              size={40}
              testID={`event-icon-${event.id}`}
            />
            <SectionTitle flex={1} numberOfLines={2}>
              {pickTranslation(event.title, locale)}
            </SectionTitle>
            <Stack alignItems="center">
              <InlineText
                fontSize={26}
                fontWeight="900"
                color={
                  primary.yesPriceCents === null
                    ? "$textMuted"
                    : primary.yesPriceCents >= 50
                      ? "$success"
                      : "$danger"
                }
              >
                {formatPercentCents(primary.yesPriceCents)}
              </InlineText>
              <Body fontSize={10}>{t("predict.probability")}</Body>
            </Stack>
          </Row>
          {primary.closed || primary.result || !primary.acceptingOrders ? (
            <Row>
              <OutcomeResultBadge market={primary} />
            </Row>
          ) : (
            <YesNoButtons
              yes={primary.yesPriceCents}
              disabled={!primary.acceptingOrders || orderDisabled}
              onPress={(outcome) => onOrder(primary, outcome)}
            />
          )}
        </Stack>
      ) : null}
      <Row gap="$3">
        <Body fontSize={11}>
          {fill(t("predict.volume"), {
            amount: formatUsd(event.volumeUsd, locale, { compact: true }),
          })}
        </Body>
        {event.volume24hUsd > 0 ? (
          <Body fontSize={11}>
            {fill(t("predict.volume24h"), {
              amount: formatUsd(event.volume24hUsd, locale, { compact: true }),
            })}
          </Body>
        ) : null}
      </Row>
    </Card>
  );
}

function SportsBody({
  event,
  onOrder,
}: {
  event: PredictEvent;
  onOrder: (market: Market, outcome: Outcome) => void;
}) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const sports = event.sports;
  if (!sports) return null;
  const [home, draw, away] = event.markets;
  const cells = [
    { label: pickTranslation(sports.home, locale), market: home },
    { label: t("predict.draw"), market: draw },
    { label: pickTranslation(sports.away, locale), market: away },
  ];
  return (
    <Stack gap="$2">
      <Row alignItems="center" justifyContent="center" gap="$3">
        <TeamMark code={sports.homeCode} />
        <SectionTitle>{pickTranslation(sports.home, locale)}</SectionTitle>
        <Body>vs</Body>
        <SectionTitle>{pickTranslation(sports.away, locale)}</SectionTitle>
        <TeamMark code={sports.awayCode} />
      </Row>
      <Row gap="$2">
        {cells.map((cell) =>
          cell.market ? (
            <Stack
              key={cell.market.id}
              flex={1}
              padding="$2"
              borderRadius="$3"
              backgroundColor="$surfaceVariant"
              alignItems="center"
              gap="$0.5"
              onPress={() => onOrder(cell.market as Market, "yes")}
              accessibilityRole="button"
              pressStyle={{ opacity: 0.75 }}
            >
              <Body fontSize={11} numberOfLines={1}>
                {cell.label}
              </Body>
              <InlineText fontWeight="800">
                {formatCents(cell.market.yesPriceCents)}
              </InlineText>
            </Stack>
          ) : null,
        )}
      </Row>
    </Stack>
  );
}

function TeamMark({ code }: { code: string }) {
  return (
    <Stack
      width={28}
      height={28}
      borderRadius={14}
      backgroundColor="$surfaceVariant"
      alignItems="center"
      justifyContent="center"
    >
      <InlineText fontSize={10} fontWeight="900">
        {code}
      </InlineText>
    </Stack>
  );
}
