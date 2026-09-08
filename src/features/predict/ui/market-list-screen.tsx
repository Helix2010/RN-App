import {
  usePredictAccountBalance,
  usePredictEnablement,
} from "../hooks/use-predict-account";
import { enablementComplete } from "../api/account-gateway";
import { shouldPromptEnable } from "../model/enable-prompt";
import { useEffect, useMemo, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import {
  formatMoney,
  formatPercentCents,
  formatUsd,
} from "../../../core/i18n/format";
import { pickTranslation } from "../../../core/i18n/localized-text";
import { isZero } from "../../../core/money/money";
import {
  AppIcon,
  Body,
  Content,
  HorizontalScroll,
  IconButton,
  InlineText,
  Page,
  PageScroll,
  PrimaryButton,
  Row,
  SecondaryButton,
  SectionTitle,
  SkeletonBlock,
  Stack,
  TextField,
  useTheme,
} from "../../../design-system";
import { useSession } from "../../session/hooks/use-session";
import {
  useCuratedEvents,
  useFavoriteEvents,
  useMarketStream,
  usePredictEvents,
  usePredictTags,
  useSeriesList,
} from "../hooks/use-predict";
import {
  matchesEventSearch,
  topByProbability,
  topByVolume24h,
} from "../model/event-search";
import { useFavoritesStore } from "../model/favorites-store";
import type {
  EventQuery,
  Market,
  Outcome,
  PredictEvent,
  Series,
} from "../model/predict";
import { SeriesCard } from "./series-card";
import { EventCard, YesNoButtons, fill } from "./shared";

type StatusFilter = NonNullable<EventQuery["status"]>;
const STATUS_OPTIONS: StatusFilter[] = ["trading", "closed", "all"];
const SORT_OPTIONS: NonNullable<EventQuery["sort"]>[] = [
  "volume",
  "volume24h",
  "liquidity",
  "endingSoon",
  "newest",
];

/**
 * P-01 市场列表：顶栏余额 chip、搜索、分类 chip、状态 / 收藏 / 排序、
 * 平台策展的精选轮播与榜单、周期市场、三种卡型。
 * 整页只在预测模块开着时挂载（ModuleGate + 入口隐藏），这里不再重复判断。
 */
export function MarketListScreen({
  onOpenEvent,
  onOpenSeries,
  onOrder,
  onOpenTransfer,
  onOpenEnable,
  onOpenPositions,
  onOpenLeaderboard,
  showPositionsEntry,
}: {
  onOpenEvent: (event: PredictEvent, market?: Market) => void;
  onOpenSeries: (series: Series) => void;
  onOrder: (market: Market, outcome: Outcome) => void;
  onOpenTransfer: () => void;
  /** 进入启用引导：账户没启用时顶栏按钮与一次性自动弹出都走这里 */
  onOpenEnable: () => void;
  onOpenPositions: () => void;
  onOpenLeaderboard: () => void;
  showPositionsEntry: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const theme = useTheme();
  const session = useSession();
  const address = session.data?.address;
  const balance = usePredictAccountBalance(address);
  const enablement = usePredictEnablement(address);
  // 已登录、租户接了平台、账户还没启用：每个地址在本次进程里自动进一次引导
  useEffect(() => {
    if (!address || !enablement.data) return;
    if (!enablement.data.configured || enablementComplete(enablement.data))
      return;
    if (shouldPromptEnable(address)) onOpenEnable();
  }, [address, enablement.data, onOpenEnable]);
  const tags = usePredictTags();
  const [pickedTag, setTagId] = useState<string | null>(null);
  // 默认选平台给的第一个标签（网页版的"热门"）；标签没到之前不带 tag 过滤
  const defaultTag = tags.data?.[0]?.id;
  const tagId = pickedTag ?? defaultTag;
  const [sort, setSort] = useState<NonNullable<EventQuery["sort"]>>("volume");
  const [status, setStatus] = useState<StatusFilter>("trading");
  const [search, setSearch] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const favoriteIds = useFavoritesStore((state) => state.ids);
  const events = usePredictEvents(
    { tagId, sort, status, limit: 20 },
    { enabled: !favoritesOnly },
  );
  // 收藏视图逐个取事件（收藏的 id 不一定在当前分页里）
  const favoriteQueries = useFavoriteEvents(favoritesOnly ? favoriteIds : []);
  // 策展（精选轮播 / 榜单）与周期市场只在默认标签 + 交易中视图展示
  const discovery =
    tagId === defaultTag && status === "trading" && !favoritesOnly;
  const curated = useCuratedEvents({ enabled: discovery });
  const seriesList = useSeriesList({ enabled: discovery });
  const heroes = useMemo(
    () => (curated.data ?? []).filter((item) => item.hero !== null),
    [curated.data],
  );
  const heroIds = useMemo(
    () => new Set(heroes.map((item) => item.event.id)),
    [heroes],
  );
  // 当前视图的事件：收藏视图来自逐个查询，其余来自分页；再套本地搜索
  const visible = useMemo(() => {
    const source = favoritesOnly
      ? favoriteQueries.flatMap((query) => (query.data ? [query.data] : []))
      : (events.data?.items ?? []);
    return source.filter((event) => matchesEventSearch(event, search));
  }, [events.data, favoriteQueries, favoritesOnly, search]);
  const topProbability = useMemo(
    () => (discovery ? topByProbability(events.data?.items ?? []) : []),
    [discovery, events.data],
  );
  const topToday = useMemo(
    () => (discovery ? topByVolume24h(events.data?.items ?? []) : []),
    [discovery, events.data],
  );
  // 列表与精选卡片里展示的市场走实时行情（每个事件最多前 3 个结果）
  useMarketStream(
    [...heroes.map((item) => item.event), ...visible].flatMap((item) =>
      item.markets.slice(0, 3).map((market) => market.id),
    ),
  );
  const listLoading = favoritesOnly
    ? favoriteQueries.some((query) => query.isPending)
    : events.data === undefined && !events.isError;
  const listError = favoritesOnly
    ? favoriteQueries.some((query) => query.isError)
    : events.isError;
  const retry = () => {
    if (favoritesOnly) favoriteQueries.forEach((query) => void query.refetch());
    else void events.refetch();
  };

  return (
    <Page>
      <PageScroll
        refresh={{
          refreshing: events.isRefetching,
          onRefresh: () => void events.refetch(),
          accessibilityLabel: t("action.refresh"),
        }}
      >
        <Content paddingTop={insets.top + 16} gap="$3">
          <Row alignItems="center" justifyContent="space-between">
            <SectionTitle fontSize={20}>{t("predict.title")}</SectionTitle>
            <Row alignItems="center" gap="$2">
              {address ? (
                balance.notEnabled ? (
                  <PrimaryButton
                    height={32}
                    paddingHorizontal="$3"
                    fontSize={12}
                    onPress={onOpenEnable}
                    testID="predict-enable"
                  >
                    {t("predict.enableChip")}
                  </PrimaryButton>
                ) : balance.data && isZero(balance.data.available) ? (
                  <PrimaryButton
                    height={32}
                    paddingHorizontal="$3"
                    fontSize={12}
                    onPress={onOpenTransfer}
                    testID="predict-topup"
                  >
                    {t("predict.topUp")}
                  </PrimaryButton>
                ) : (
                  <Row
                    alignItems="center"
                    gap="$1"
                    paddingHorizontal="$2.5"
                    paddingVertical="$1.5"
                    borderRadius={999}
                    backgroundColor="$surfaceVariant"
                    onPress={onOpenTransfer}
                    accessibilityRole="button"
                    accessibilityLabel={t("assets.predictAccount")}
                    testID="predict-balance"
                  >
                    <AppIcon
                      name="wallet-outline"
                      size={14}
                      colorToken="textMuted"
                    />
                    <InlineText fontSize={12} fontWeight="700">
                      {balance.data
                        ? formatMoney(balance.data.available, locale)
                        : "—"}
                    </InlineText>
                  </Row>
                )
              ) : null}
              <IconButton
                label={t("predict.leaderboard.title")}
                icon="trophy-outline"
                size={30}
                onPress={onOpenLeaderboard}
              />
              {showPositionsEntry ? (
                <IconButton
                  label={t("predict.positions.title")}
                  icon="chart-box-outline"
                  size={30}
                  onPress={onOpenPositions}
                />
              ) : null}
            </Row>
          </Row>

          <TextField
            value={search}
            onChangeText={setSearch}
            placeholder={t("predict.search.placeholder")}
            accessibilityLabel={t("predict.search.placeholder")}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            testID="predict-search"
          />

          <HorizontalScroll>
            {(tags.data ?? []).map((tag) => {
              const selected = tag.id === tagId;
              return (
                <Stack
                  key={tag.id}
                  paddingHorizontal="$3"
                  paddingVertical="$1.5"
                  borderRadius={999}
                  backgroundColor={selected ? "$color" : "$surfaceVariant"}
                  onPress={() => setTagId(tag.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  pressStyle={{ opacity: 0.75 }}
                >
                  <InlineText
                    fontSize={13}
                    fontWeight="700"
                    color={selected ? "$background" : "$color"}
                  >
                    {pickTranslation(tag.label, locale)}
                  </InlineText>
                </Stack>
              );
            })}
          </HorizontalScroll>

          <HorizontalScroll>
            {STATUS_OPTIONS.map((option) => (
              <FilterChip
                key={option}
                label={t(`predict.filter.status.${option}`)}
                selected={!favoritesOnly && status === option}
                onPress={() => {
                  setFavoritesOnly(false);
                  setStatus(option);
                }}
                testID={`predict-status-${option}`}
              />
            ))}
            <FilterChip
              label={`★ ${t("predict.filter.favorites")}`}
              selected={favoritesOnly}
              onPress={() => setFavoritesOnly((value) => !value)}
              testID="predict-favorites"
            />
          </HorizontalScroll>

          <HorizontalScroll>
            {SORT_OPTIONS.map((option) => (
              <FilterChip
                key={option}
                label={t(`predict.sort.${option}`)}
                selected={sort === option}
                onPress={() => setSort(option)}
                testID={`predict-sort-${option}`}
              />
            ))}
          </HorizontalScroll>

          {discovery && heroes.length > 0 ? (
            <HorizontalScroll>
              {heroes.map(({ event }) => (
                <Stack
                  key={event.id}
                  width={300}
                  padding="$3"
                  borderRadius="$4"
                  gap="$2"
                  style={{ backgroundColor: `${theme.primary.val}42` }}
                  onPress={() => onOpenEvent(event)}
                  accessibilityRole="button"
                  testID={`predict-hero-${event.id}`}
                >
                  <Row alignItems="center" gap="$2">
                    <AppIcon
                      name="star-four-points"
                      size={14}
                      colorToken="primary"
                    />
                    <InlineText fontSize={11} fontWeight="800" color="$primary">
                      {t("predict.curation.hero")} ·{" "}
                      {pickTranslation(event.category, locale).toUpperCase()}
                    </InlineText>
                  </Row>
                  <SectionTitle numberOfLines={2}>
                    {pickTranslation(event.title, locale)}
                  </SectionTitle>
                  {event.markets.slice(0, 3).map((market) => (
                    <Row key={market.id} alignItems="center" gap="$2">
                      <Body flex={1} color="$color" numberOfLines={1}>
                        {pickTranslation(market.outcomeLabel, locale)}
                      </Body>
                      <InlineText fontWeight="800" width={44} textAlign="right">
                        {formatPercentCents(market.yesPriceCents)}
                      </InlineText>
                      <Stack width={132}>
                        <YesNoButtons
                          yes={market.yesPriceCents}
                          compact
                          disabled={!market.acceptingOrders}
                          onPress={(outcome) => onOrder(market, outcome)}
                        />
                      </Stack>
                    </Row>
                  ))}
                  <Body fontSize={11}>
                    {fill(t("predict.outcomes"), { n: event.markets.length })} ·{" "}
                    {fill(t("predict.volume"), {
                      amount: formatUsd(event.volumeUsd, locale, {
                        compact: true,
                      }),
                    })}
                  </Body>
                </Stack>
              ))}
            </HorizontalScroll>
          ) : null}

          {discovery && (topProbability.length > 0 || topToday.length > 0) ? (
            <Row gap="$2" alignItems="flex-start">
              {topProbability.length > 0 ? (
                <RankList
                  title={t("predict.curation.topProbability")}
                  items={topProbability.map(({ event, cents }) => ({
                    event,
                    value: formatPercentCents(cents),
                  }))}
                  onOpen={onOpenEvent}
                  testID="predict-top-probability"
                />
              ) : null}
              {topToday.length > 0 ? (
                <RankList
                  title={t("predict.curation.topToday")}
                  items={topToday.map((event) => ({
                    event,
                    value: formatUsd(event.volume24hUsd, locale, {
                      compact: true,
                    }),
                  }))}
                  onOpen={onOpenEvent}
                  testID="predict-top-today"
                />
              ) : null}
            </Row>
          ) : null}

          {discovery && seriesList.data && seriesList.data.length > 0 ? (
            <Stack gap="$2" testID="predict-series">
              <SectionTitle fontSize={14}>
                {t("predict.series.title")}
              </SectionTitle>
              {seriesList.data.map((series) => (
                <SeriesCard
                  key={series.id}
                  series={series}
                  onOpen={onOpenSeries}
                  onOrder={onOrder}
                />
              ))}
            </Stack>
          ) : null}

          {favoritesOnly && favoriteIds.length === 0 ? (
            <Body testID="predict-favorites-empty">
              {t("predict.favorites.empty")}
            </Body>
          ) : !listLoading && !listError ? (
            visible.length === 0 ? (
              <Body>
                {search.trim() ? t("predict.search.empty") : t("state.empty")}
              </Body>
            ) : (
              visible
                .filter((event) => !(discovery && heroIds.has(event.id)))
                .map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onOpen={onOpenEvent}
                    onOrder={onOrder}
                  />
                ))
            )
          ) : listError ? (
            <Row alignItems="center" justifyContent="space-between">
              <Body color="$danger">{t("state.error")}</Body>
              <SecondaryButton height={32} onPress={retry}>
                {t("action.retryNow")}
              </SecondaryButton>
            </Row>
          ) : (
            <Stack gap="$2">
              <SkeletonBlock height={150} borderRadius="$4" />
              <SkeletonBlock height={150} borderRadius="$4" />
              <SkeletonBlock height={150} borderRadius="$4" />
            </Stack>
          )}
        </Content>
      </PageScroll>
    </Page>
  );
}

function FilterChip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Row
      alignItems="center"
      gap="$1"
      paddingHorizontal="$2.5"
      paddingVertical="$1"
      borderRadius={999}
      borderWidth={1}
      borderColor={selected ? "$primary" : "$borderColor"}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      testID={testID}
    >
      <InlineText
        fontSize={12}
        fontWeight="600"
        color={selected ? "$primary" : "$textMuted"}
      >
        {label}
      </InlineText>
    </Row>
  );
}

/** 榜单：网页版首页的"高概率 / 今日热门"三条，点行进详情 */
function RankList({
  title,
  items,
  onOpen,
  testID,
}: {
  title: string;
  items: { event: PredictEvent; value: string }[];
  onOpen: (event: PredictEvent) => void;
  testID?: string;
}) {
  const { config } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  return (
    <Stack
      flex={1}
      gap="$1.5"
      padding="$2.5"
      borderRadius="$4"
      backgroundColor="$surfaceVariant"
      testID={testID}
    >
      <SectionTitle fontSize={12}>{title}</SectionTitle>
      {items.map(({ event, value }, index) => (
        <Row
          key={event.id}
          alignItems="center"
          gap="$1.5"
          onPress={() => onOpen(event)}
          accessibilityRole="button"
        >
          <Body fontSize={11} width={12}>
            {index + 1}
          </Body>
          <Body flex={1} fontSize={11} color="$color" numberOfLines={1}>
            {pickTranslation(event.title, locale)}
          </Body>
          <InlineText fontSize={11} fontWeight="800">
            {value}
          </InlineText>
        </Row>
      ))}
    </Stack>
  );
}
