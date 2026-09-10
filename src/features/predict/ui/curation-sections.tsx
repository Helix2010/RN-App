import { useState } from "react";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { formatPercentCents, formatUsd } from "../../../core/i18n/format";
import { pickTranslation } from "../../../core/i18n/localized-text";
import {
  AppIcon,
  Body,
  InlineText,
  Row,
  SectionTitle,
  SkeletonBlock,
  SnapCarousel,
  Stack,
} from "../../../design-system";
import type { RankBoard, RankKey } from "../model/event-search";
import { topYesCents } from "../model/event-search";
import type { Market, Outcome, PredictEvent } from "../model/predict";
import { EventImage, FavoriteButton, YesNoButtons, fill } from "./shared";

/** 精选轮播下一张露出的宽度：与首页"热门预测"一致 */
const FEATURED_PEEK = 32;
/** 海报图比例：宽 / 高 */
const FEATURED_IMAGE_RATIO = 16 / 9;
/** 标题固定两行（`SectionTitle` 行高 22）：轮播里卡片等高，骨架换成内容也不改高度 */
const FEATURED_TITLE_HEIGHT = 44;
/** 报价行高度 = 紧凑 Yes/No 按钮高度 */
const FEATURED_QUOTE_HEIGHT = 34;
/** 成交量行高度 = `Body` 行高 */
const FEATURED_META_HEIGHT = 22;
/** Yes/No 按钮块宽度：与 `FeaturedCard`、`EventCard` 一致 */
const FEATURED_ACTION_WIDTH = 132;
/** 加载中占位的卡片张数：与首页"热门预测"一致，够表达"这里可以横滑" */
const FEATURED_SKELETON_CARDS = 2;

/**
 * 精选（设计 predict-discovery-polish §3）：运营 hero 位的海报卡。
 * 只有一张时不用轮播；≥2 张走 SnapCarousel（吸附 + peek + 页点），和首页同一套手感。
 *
 * `loading` 时画同形骨架，而且骨架与卡片挂在同一个 SnapCarousel 上：轮播在骨架阶段就把
 * 视口宽度量好，数据到了直接换内容，不再出现"卡片凭空插进来把列表推下去"的一闪。
 */
export function FeaturedSection({
  events,
  loading,
  onOpen,
  onOrder,
  orderDisabled,
}: {
  events: PredictEvent[];
  /** 策展还没回来（失败由调用方的错误行表达，不走骨架） */
  loading: boolean;
  onOpen: (event: PredictEvent) => void;
  onOrder: (market: Market, outcome: Outcome) => void;
  orderDisabled: boolean;
}) {
  const { t } = useFoundationRuntime();
  if (!loading && events.length === 0) return null;
  const cards = loading
    ? Array.from({ length: FEATURED_SKELETON_CARDS }, (_, index) => (
        <FeaturedCardSkeleton key={`skeleton-${index}`} />
      ))
    : events.map((event) => (
        <FeaturedCard
          key={event.id}
          event={event}
          onOpen={onOpen}
          onOrder={onOrder}
          orderDisabled={orderDisabled}
        />
      ));
  return (
    <Stack gap="$2" testID="predict-featured">
      <SectionTitle fontSize={14}>{t("predict.curation.title")}</SectionTitle>
      {!loading && events.length === 1 ? (
        cards
      ) : (
        <SnapCarousel
          fullWidth
          peek={FEATURED_PEEK}
          showDots
          testID="predict-featured-carousel"
        >
          {cards}
        </SnapCarousel>
      )}
    </Stack>
  );
}

/** 精选卡骨架：与 `FeaturedCard` 同一套外框、同一批固定高度，数据到了不改高度 */
function FeaturedCardSkeleton() {
  return (
    <Stack
      padding="$3"
      gap="$2"
      borderRadius="$4"
      borderWidth={1}
      borderColor="$borderColor"
      backgroundColor="$surface"
      testID="predict-hero-skeleton"
    >
      <SkeletonBlock
        width="100%"
        aspectRatio={FEATURED_IMAGE_RATIO}
        borderRadius={12}
      />
      <Stack height={FEATURED_TITLE_HEIGHT} justifyContent="center" gap="$1.5">
        <SkeletonBlock height={16} width="88%" />
        <SkeletonBlock height={16} width="52%" />
      </Stack>
      <Row height={FEATURED_QUOTE_HEIGHT} alignItems="center" gap="$2">
        <SkeletonBlock flex={1} height={16} />
        <SkeletonBlock width={44} height={16} />
        <Row width={FEATURED_ACTION_WIDTH} gap="$2">
          <SkeletonBlock
            flex={1}
            height={FEATURED_QUOTE_HEIGHT}
            borderRadius="$3"
          />
          <SkeletonBlock
            flex={1}
            height={FEATURED_QUOTE_HEIGHT}
            borderRadius="$3"
          />
        </Row>
      </Row>
      <Stack height={FEATURED_META_HEIGHT} justifyContent="center">
        <SkeletonBlock height={12} width="64%" />
      </Stack>
    </Stack>
  );
}

function FeaturedCard({
  event,
  onOpen,
  onOrder,
  orderDisabled,
}: {
  event: PredictEvent;
  onOpen: (event: PredictEvent) => void;
  onOrder: (market: Market, outcome: Outcome) => void;
  orderDisabled: boolean;
}) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const first = event.markets[0];
  const badge = [
    t("predict.curation.hero"),
    pickTranslation(event.category, locale).toUpperCase(),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Stack
      padding="$3"
      gap="$2"
      borderRadius="$4"
      borderWidth={1}
      borderColor="$borderColor"
      backgroundColor="$surface"
      onPress={() => onOpen(event)}
      accessibilityRole="button"
      testID={`predict-hero-${event.id}`}
    >
      <Stack position="relative">
        {event.imageUrl ? (
          <EventImage
            uri={event.imageUrl}
            aspectRatio={FEATURED_IMAGE_RATIO}
            radius={12}
            testID={`hero-image-${event.id}`}
          />
        ) : (
          <Stack
            width="100%"
            aspectRatio={FEATURED_IMAGE_RATIO}
            borderRadius={12}
            backgroundColor="$surfaceVariant"
          />
        )}
        <Row
          position="absolute"
          top={8}
          left={8}
          alignItems="center"
          gap="$1"
          paddingHorizontal="$2"
          paddingVertical="$1"
          borderRadius={999}
          backgroundColor="rgba(0,0,0,0.55)"
        >
          <AppIcon name="star-four-points" size={12} colorToken="primary" />
          <InlineText fontSize={11} fontWeight="800" color="white">
            {badge}
          </InlineText>
        </Row>
        <Stack position="absolute" top={4} right={4}>
          <FavoriteButton eventId={event.id} size={30} />
        </Stack>
      </Stack>
      {/* 固定两行：轮播里卡片等高，标题长短不再改整卡高度，骨架也能对齐 */}
      <SectionTitle numberOfLines={2} minHeight={FEATURED_TITLE_HEIGHT}>
        {pickTranslation(event.title, locale)}
      </SectionTitle>
      {first && first.yesPriceCents === null ? (
        // 没有报价就不画两颗"—"按钮：那看起来像坏了
        <Row minHeight={FEATURED_QUOTE_HEIGHT} alignItems="center" gap="$2">
          <Body flex={1} color="$color" numberOfLines={1}>
            {pickTranslation(first.outcomeLabel, locale)}
          </Body>
          <Body color="$textMuted" testID={`predict-hero-no-quote-${event.id}`}>
            {t("predict.series.noQuote")}
          </Body>
        </Row>
      ) : first ? (
        <Row minHeight={FEATURED_QUOTE_HEIGHT} alignItems="center" gap="$2">
          <Body flex={1} color="$color" numberOfLines={1}>
            {pickTranslation(first.outcomeLabel, locale)}
          </Body>
          <InlineText fontWeight="800" width={44} textAlign="right">
            {formatPercentCents(first.yesPriceCents)}
          </InlineText>
          <Stack width={FEATURED_ACTION_WIDTH}>
            <YesNoButtons
              yes={first.yesPriceCents}
              compact
              disabled={!first.acceptingOrders || orderDisabled}
              onPress={(outcome) => onOrder(first, outcome)}
            />
          </Stack>
        </Row>
      ) : null}
      <Body fontSize={11}>
        {fill(t("predict.curation.outcomes"), { n: event.markets.length })} ·{" "}
        {fill(t("predict.volume"), {
          amount: formatUsd(event.volumeUsd, locale, { compact: true }),
        })}
      </Body>
    </Stack>
  );
}

const RANK_LABEL_KEY: Record<RankKey, string> = {
  hotPicks: "predict.curation.hotPicks",
  breaking: "predict.curation.breaking",
  topProbability: "predict.curation.topProbability",
  topToday: "predict.curation.topToday",
};

/**
 * 榜单（设计 §4）：四个榜合成一个区块，tab 切换，单列完整标题，右侧数值带单位徽标。
 * 输入已经过 buildRankBoards 去重；这里只负责展示。
 */
export function RankBoards({
  boards,
  onOpen,
  onViewAll,
}: {
  boards: RankBoard[];
  onOpen: (event: PredictEvent) => void;
  /** 当前 tab 有对应的完整视图时给出（今日热门 → 24h 成交排序）；没有就不显示"查看全部" */
  onViewAll?: (key: RankKey) => void;
}) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const [picked, setPicked] = useState<RankKey | null>(null);
  if (boards.length === 0) return null;
  // 选中的 tab 随数据消失时回到第一个：渲染期推导，不用 effect
  const activeKey =
    picked && boards.some((board) => board.key === picked)
      ? picked
      : boards[0]!.key;
  const active = boards.find((board) => board.key === activeKey)!;
  const unit =
    activeKey === "topToday"
      ? t("predict.curation.unit.volume24h")
      : t("predict.curation.unit.probability");
  return (
    <Stack
      gap="$2"
      padding="$3"
      borderRadius="$4"
      backgroundColor="$surfaceVariant"
      testID="predict-rank-boards"
    >
      <Row alignItems="center" justifyContent="space-between" gap="$2">
        <SectionTitle fontSize={14}>
          {t("predict.curation.rankTitle")}
        </SectionTitle>
        {onViewAll && activeKey === "topToday" ? (
          <Row
            alignItems="center"
            onPress={() => onViewAll(activeKey)}
            accessibilityRole="link"
            pressStyle={{ opacity: 0.6 }}
            testID="predict-rank-view-all"
          >
            <InlineText fontSize={12} fontWeight="700" color="$primary">
              {t("predict.curation.viewAll")}
            </InlineText>
            <AppIcon name="chevron-right" size={15} colorToken="primary" />
          </Row>
        ) : null}
      </Row>
      {boards.length > 1 ? (
        <Row gap="$2" flexWrap="wrap" testID="predict-rank-tabs">
          {boards.map((board) => {
            const selected = board.key === activeKey;
            return (
              <Stack
                key={board.key}
                paddingHorizontal="$2.5"
                paddingVertical="$1"
                borderRadius={999}
                backgroundColor={selected ? "$color" : "$surface"}
                onPress={() => setPicked(board.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                pressStyle={{ opacity: 0.75 }}
                testID={`predict-rank-tab-${board.key}`}
              >
                <InlineText
                  fontSize={12}
                  fontWeight="700"
                  color={selected ? "$background" : "$color"}
                >
                  {t(RANK_LABEL_KEY[board.key])}
                </InlineText>
              </Stack>
            );
          })}
        </Row>
      ) : null}
      <Stack gap="$1" testID={`predict-rank-${activeKey}`}>
        {active.events.map((event, index) => (
          <Row
            key={event.id}
            alignItems="center"
            gap="$2"
            minHeight={40}
            onPress={() => onOpen(event)}
            accessibilityRole="button"
            pressStyle={{ opacity: 0.7 }}
            testID={`predict-rank-row-${event.id}`}
          >
            <InlineText
              fontSize={12}
              fontWeight="800"
              color="$textMuted"
              width={16}
            >
              {index + 1}
            </InlineText>
            <Body flex={1} fontSize={13} color="$color" numberOfLines={2}>
              {pickTranslation(event.title, locale)}
            </Body>
            <Stack alignItems="flex-end">
              <InlineText fontSize={13} fontWeight="800">
                {activeKey === "topToday"
                  ? formatUsd(event.volume24hUsd, locale, { compact: true })
                  : formatPercentCents(topYesCents(event))}
              </InlineText>
              <InlineText fontSize={10} color="$textMuted">
                {unit}
              </InlineText>
            </Stack>
          </Row>
        ))}
      </Stack>
    </Stack>
  );
}
