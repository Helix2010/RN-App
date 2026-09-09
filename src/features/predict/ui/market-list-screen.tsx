import {
  usePredictAccountBalance,
  usePredictEnablement,
} from "../hooks/use-predict-account";
import { enablementComplete } from "../api/account-gateway";
import { shouldPromptEnable } from "../model/enable-prompt";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { formatMoney } from "../../../core/i18n/format";
import { pickTranslation } from "../../../core/i18n/localized-text";
import { isZero } from "../../../core/money/money";
import {
  AppIcon,
  Body,
  CollapseAnchor,
  CollapsingHeader,
  HorizontalScroll,
  IconButton,
  InlineText,
  PrimaryButton,
  Row,
  SecondaryButton,
  SectionTitle,
  SkeletonBlock,
  Stack,
  TextField,
} from "../../../design-system";
import { useSession } from "../../session/hooks/use-session";
import {
  useCuratedEvents,
  useFavoriteEvents,
  useMarketStream,
  usePredictEvents,
  usePredictTags,
  useRegionGate,
  useSeriesList,
} from "../hooks/use-predict";
import {
  buildRankBoards,
  curationZone,
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
import { FeaturedSection, RankBoards } from "./curation-sections";
import { SeriesCard } from "./series-card";
import { EventCard, RegionNotice, fill } from "./shared";

type StatusFilter = NonNullable<EventQuery["status"]>;
/** 榜单每榜最多几行 / 去重前每个来源取多少候选 */
const RANK_ROWS = 5;
const RANK_CANDIDATES = 10;
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
  const listScroll = useRef<ScrollView>(null);
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
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
  // 地区限制：列表页在预测页签内（模块开着才挂载），这里发起一次检查
  const region = useRegionGate();
  const events = usePredictEvents(
    { tagId, sort, status, limit: 20 },
    { enabled: !favoritesOnly },
  );
  // 收藏视图逐个取事件（收藏的 id 不一定在当前分页里）
  const favoriteQueries = useFavoriteEvents(favoritesOnly ? favoriteIds : []);
  // 策展（精选轮播 / 榜单）与周期市场只在默认标签 + 交易中视图展示；搜索时收起，让结果直接可见
  const discovery =
    tagId === defaultTag &&
    status === "trading" &&
    !favoritesOnly &&
    search.trim() === "";
  const curated = useCuratedEvents({ enabled: discovery });
  // 周期市场（BTC 涨跌等）：列表按网页版排除了周期单期事件，系列卡在默认标签和 crypto 标签下显示
  // （网页版 `loadRecurringSeries`：type 为 all / crypto 且没有搜索词）。dev 上 crypto 标签只有周期事件，
  // 不这样做 crypto 页就是空的。
  const selectedTagSlug = tags.data?.find((tag) => tag.id === tagId)?.slug;
  const showSeries =
    status === "trading" &&
    !favoritesOnly &&
    search.trim() === "" &&
    (tagId === defaultTag || selectedTagSlug === "crypto");
  const seriesList = useSeriesList({ enabled: showSeries });
  // 策展三区：hero 轮播、highlight"热门精选"、normal"突发"，都按运营位次排
  const heroes = useMemo(
    () => curationZone(curated.data ?? [], "hero"),
    [curated.data],
  );
  // 榜单候选取多一些（去重后每榜最多 5 行）
  const hotPicks = useMemo(
    () => curationZone(curated.data ?? [], "highlight", RANK_CANDIDATES),
    [curated.data],
  );
  const breaking = useMemo(
    () => curationZone(curated.data ?? [], "normal", RANK_CANDIDATES),
    [curated.data],
  );
  const heroIds = useMemo(
    () => new Set(heroes.map((event) => event.id)),
    [heroes],
  );
  // 当前视图的事件：收藏视图来自逐个查询（单个失败不拖累其余），其余来自分页；再套本地搜索，
  // 已在精选轮播里的不再重复出现在列表
  const listItems = useMemo(() => {
    const source = favoritesOnly
      ? favoriteQueries.flatMap((query) => (query.data ? [query.data] : []))
      : (events.data?.items ?? []);
    return source.filter(
      (event) =>
        matchesEventSearch(event, search) &&
        !(discovery && heroIds.has(event.id)),
    );
  }, [discovery, events.data, favoriteQueries, favoritesOnly, heroIds, search]);
  // 本地榜单只在默认排序下有意义（按"最新"排的一页取前三没有"高概率"的含义）
  const localRanks = discovery && sort === "volume";
  const topProbability = useMemo(
    () =>
      localRanks
        ? topByProbability(events.data?.items ?? [], RANK_CANDIDATES).map(
            (item) => item.event,
          )
        : [],
    [localRanks, events.data],
  );
  const topToday = useMemo(
    () =>
      localRanks
        ? topByVolume24h(events.data?.items ?? [], RANK_CANDIDATES)
        : [],
    [localRanks, events.data],
  );
  // 榜单去重（精选里的不进榜；一个事件只进优先级最高的榜）
  const rankBoards = useMemo(
    () =>
      discovery
        ? buildRankBoards(
            { heroIds, hotPicks, breaking, topProbability, topToday },
            RANK_ROWS,
          )
        : [],
    [discovery, heroIds, hotPicks, breaking, topProbability, topToday],
  );
  // 列表与精选卡片里展示的市场走实时行情（每个事件最多前 3 个结果）
  useMarketStream(
    [...heroes, ...listItems].flatMap((item) =>
      item.markets.slice(0, 3).map((market) => market.id),
    ),
  );
  const favoriteFailed = favoriteQueries.filter((query) => query.isError);
  const listLoading = favoritesOnly
    ? favoriteQueries.length > 0 &&
      favoriteQueries.every((query) => query.isPending)
    : events.data === undefined && !events.isError;
  // 收藏视图里单个失败只提示那几个，其余照常显示；分页视图失败就是整页失败
  const listError = favoritesOnly
    ? favoriteQueries.length > 0 &&
      favoriteQueries.every((query) => query.isError)
    : events.isError;
  const retry = () => {
    if (favoritesOnly) favoriteFailed.forEach((query) => void query.refetch());
    else void events.refetch();
  };
  const refreshAll = () => {
    retry();
    if (discovery) void curated.refetch();
    if (showSeries) void seriesList.refetch();
  };

  // 分类 chip 行在内容里滚走后钉在顶部（同一份元素渲染两处），旁边放回到搜索框的放大镜
  const tagChips = (
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
  );
  return (
    <CollapsingHeader
      mode="floating"
      refresh={{
        refreshing: events.isRefetching,
        onRefresh: refreshAll,
        accessibilityLabel: t("action.refresh"),
      }}
      scrollRef={listScroll}
      contentProps={{ paddingTop: insets.top + 16, gap: "$3" }}
      collapsed={
        <>
          <Stack flex={1}>{tagChips}</Stack>
          <IconButton
            label={t("predict.search.placeholder")}
            icon="magnify"
            size={32}
            onPress={() =>
              listScroll.current?.scrollTo({ y: 0, animated: true })
            }
            testID="predict-search-pinned"
          />
        </>
      }
    >
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

      <RegionNotice state={region.state} onRetry={region.retry} />

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

      {tagChips}
      <CollapseAnchor />

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

      {discovery && curated.isError ? (
        <InlineError
          message={t("predict.curation.error")}
          retryLabel={t("action.retryNow")}
          onRetry={() => void curated.refetch()}
          testID="predict-curation-error"
        />
      ) : null}

      {discovery ? (
        <FeaturedSection
          events={heroes}
          onOpen={onOpenEvent}
          onOrder={onOrder}
          orderDisabled={region.blocked}
        />
      ) : null}

      {discovery ? (
        <RankBoards
          boards={rankBoards}
          onOpen={onOpenEvent}
          // "今日热门"有完整视图：按 24h 成交排序的列表；其它榜没有等价视图，不给入口
          onViewAll={(key) => {
            if (key === "topToday") setSort("volume24h");
          }}
        />
      ) : null}

      {showSeries && seriesList.isError ? (
        <InlineError
          message={t("predict.series.error")}
          retryLabel={t("action.retryNow")}
          onRetry={() => void seriesList.refetch()}
          testID="predict-series-error"
        />
      ) : null}

      {showSeries && seriesList.data && seriesList.data.length > 0 ? (
        <Stack gap="$2" testID="predict-series">
          <SectionTitle fontSize={14}>{t("predict.series.title")}</SectionTitle>
          {seriesList.data.map((series) => (
            <SeriesCard
              key={series.id}
              series={series}
              onOpen={onOpenSeries}
              onOrder={onOrder}
              orderDisabled={region.blocked}
            />
          ))}
        </Stack>
      ) : null}

      {favoritesOnly && !listError && favoriteFailed.length > 0 ? (
        <InlineError
          message={fill(t("predict.favorites.loadFailed"), {
            n: favoriteFailed.length,
          })}
          retryLabel={t("action.retryNow")}
          onRetry={retry}
          testID="predict-favorites-error"
        />
      ) : null}

      {favoritesOnly && favoriteIds.length === 0 ? (
        <Body testID="predict-favorites-empty">
          {t("predict.favorites.empty")}
        </Body>
      ) : !listLoading && !listError ? (
        listItems.length === 0 ? (
          // 周期市场卡已经是内容时不再提示"暂无数据"
          showSeries && (seriesList.data?.length ?? 0) > 0 ? null : (
            <Body>
              {search.trim() ? t("predict.search.empty") : t("state.empty")}
            </Body>
          )
        ) : (
          listItems.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onOpen={onOpenEvent}
              onOrder={onOrder}
              orderDisabled={region.blocked}
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
    </CollapsingHeader>
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

function InlineError({
  message,
  retryLabel,
  onRetry,
  testID,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
  testID?: string;
}) {
  return (
    <Row
      alignItems="center"
      justifyContent="space-between"
      gap="$2"
      testID={testID}
    >
      <Body color="$danger" flex={1}>
        {message}
      </Body>
      <SecondaryButton height={32} onPress={onRetry}>
        {retryLabel}
      </SecondaryButton>
    </Row>
  );
}
