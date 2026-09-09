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
  Spinner,
  Stack,
  TextField,
  TextLink,
  FilterBanner,
  FilterSelect,
  PickerSheet,
  type SheetHandle,
} from "../../../design-system";
import { useSession } from "../../session/hooks/use-session";
import {
  useCuratedEvents,
  useFavoriteEvents,
  useMarketStream,
  usePredictAllTags,
  usePredictEventPages,
  usePredictTags,
  useRegionGate,
  useRelatedTags,
  useSearchEvents,
  useSeriesList,
} from "../hooks/use-predict";
import {
  DEFAULT_FILTERS,
  SORT_OPTIONS,
  VIEW_OPTIONS,
  activeFilterSummary,
  isDiscovery,
  selectPrimary,
  selectSecondary,
  seriesMatchesTag,
  showSeriesFor,
  type Filters,
} from "../model/filter-state";
import {
  buildRankBoards,
  curationZone,
  matchesEventSearch,
  topByProbability,
  topByVolume24h,
} from "../model/event-search";
import { useFavoritesStore } from "../model/favorites-store";
import type { Market, Outcome, PredictEvent, Series } from "../model/predict";
import { FeaturedSection, RankBoards } from "./curation-sections";
import {
  EmptyTagCard,
  SearchSectionTitle,
  SubTagChip,
  TagChip,
} from "./market-filters";
import { SeriesCard } from "./series-card";
import { EventCard, RegionNotice, fill } from "./shared";

/** 榜单每榜最多几行 / 去重前每个来源取多少候选 */
const RANK_ROWS = 5;
const RANK_CANDIDATES = 10;
/** 事件列表每页条数（与网页版一致） */
const PAGE_SIZE = 40;
/** 搜索：至少几个字符才发请求 */
const SEARCH_MIN_CHARS = 2;
/** 搜索结果里最多列几个标签 */
const SEARCH_TAG_LIMIT = 5;

/**
 * P-01 市场列表（设计 predict-home-filters-2026-09-09）：顶栏余额 chip、搜索（服务端全站）、
 * 一级分类（"全部"默认 + 轮播标签 + 更多）、二级分类、视图 / 排序下拉 + 收藏开关、
 * 平台策展的精选轮播与榜单、周期市场、事件列表（40 条一页，到底翻页）。
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
  initialFilters,
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
  /** 深链进入时的初始筛选（首页"查看全部"、榜单、系列卡都用这一组参数） */
  initialFilters?: Partial<Filters>;
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
  const allTags = usePredictAllTags();
  const [filters, setFilters] = useState<Filters>(() => ({
    ...DEFAULT_FILTERS,
    ...initialFilters,
  }));
  // 搜索态：点进搜索框后筛选行收起；有 ≥2 字符时走服务端搜索
  const [searching, setSearching] = useState(false);
  const favoriteIds = useFavoritesStore((state) => state.ids);
  const carouselTags = useMemo(() => tags.data ?? [], [tags.data]);
  // 一级标签对象：先在轮播里找，再到全集里找（从"更多"面板选的）
  const primaryTag = useMemo(
    () =>
      filters.parentTag === null
        ? undefined
        : (carouselTags.find((tag) => tag.id === filters.parentTag) ??
          allTags.data?.find((tag) => tag.id === filters.parentTag)),
    [allTags.data, carouselTags, filters.parentTag],
  );
  const related = useRelatedTags(filters.parentTag);
  const secondaryTags = related.data ?? [];
  const selectedSecondary =
    filters.tag !== null && filters.tag !== filters.parentTag
      ? secondaryTags.find((tag) => tag.id === filters.tag)
      : undefined;
  // 地区限制：列表页在预测页签内（模块开着才挂载），这里发起一次检查
  const region = useRegionGate();
  const searchActive = searching && filters.q.trim().length >= SEARCH_MIN_CHARS;
  const favoritesOnly = filters.favorites;
  const events = usePredictEventPages(
    {
      tagId: filters.tag ?? undefined,
      // 只选一级时把子标签下的事件并进来（网页版 related_tags）
      includeRelated: filters.tag !== null && filters.tag === filters.parentTag,
      sort: filters.sort,
      status: filters.view,
      limit: PAGE_SIZE,
    },
    { enabled: !favoritesOnly && !searchActive },
  );
  const eventItems = useMemo(
    () => events.data?.pages.flatMap((page) => page.items) ?? [],
    [events.data],
  );
  const search = useSearchEvents(
    { q: filters.q, status: filters.view },
    { enabled: searchActive && !favoritesOnly },
  );
  const searchItems = useMemo(
    () => search.data?.pages.flatMap((page) => page.events) ?? [],
    [search.data],
  );
  const searchTags = (search.data?.pages[0]?.tags ?? []).slice(
    0,
    SEARCH_TAG_LIMIT,
  );
  const searchTotal = search.data?.pages[0]?.total ?? searchItems.length;
  // 滚到列表底部翻下一页；收藏视图是逐个查询，没有分页
  const loadMoreEvents = () => {
    const source = searchActive ? search : events;
    if (favoritesOnly || !source.hasNextPage) return;
    if (source.isFetchingNextPage || source.isFetchNextPageError) return;
    void source.fetchNextPage();
  };
  // 收藏视图逐个取事件（收藏的 id 不一定在当前分页里）
  const favoriteQueries = useFavoriteEvents(favoritesOnly ? favoriteIds : []);
  // 策展（精选轮播 / 榜单）只在全站 · 交易中 · 未搜索 · 非收藏时展示
  const discovery = isDiscovery(filters) && !searching;
  const curated = useCuratedEvents({ enabled: discovery });
  // 周期市场（BTC 涨跌等）：全部视图与 crypto 一级（含二级）下显示；二级按周期粒度过滤系列卡
  const showSeries = showSeriesFor(filters, primaryTag) && !searching;
  const seriesList = useSeriesList({ enabled: showSeries });
  const visibleSeries = useMemo(() => {
    // 不展示周期市场的视图下按空处理，缓存里的系列不能影响"该分类为空"的判断
    const all = showSeries ? (seriesList.data ?? []) : [];
    return selectedSecondary
      ? all.filter((series) => seriesMatchesTag(series, selectedSecondary.slug))
      : all;
  }, [selectedSecondary, seriesList.data, showSeries]);
  const scrollToTop = () =>
    listScroll.current?.scrollTo({ y: 0, animated: true });
  const pickPrimary = (tagId: string | null) => {
    setFilters((current) => selectPrimary(current, tagId));
    setSearching(false);
    scrollToTop();
  };
  const pickSecondary = (childId: string | null) => {
    setFilters((current) => selectSecondary(current, childId));
    scrollToTop();
  };
  const toggleFavorites = () =>
    setFilters((current) => ({ ...current, favorites: !current.favorites }));
  const exitSearch = () => {
    setSearching(false);
    setFilters((current) => ({ ...current, q: "" }));
  };
  const viewLabel = (view: Filters["view"]) =>
    t(`predict.filter.status.${view}`);
  const sortLabel = (sort: Filters["sort"]) => t(`predict.sort.${sort}`);
  const filterSummary = activeFilterSummary(filters, {
    view: viewLabel,
    sort: sortLabel,
  });
  const tagPicker = useRef<SheetHandle>(null);
  // 从"更多"面板选的、不在轮播里的标签，以选中态插到"更多"左边
  const extraPrimary =
    primaryTag && !carouselTags.some((tag) => tag.id === primaryTag.id)
      ? primaryTag
      : undefined;
  const showMoreTags = (allTags.data?.length ?? 0) > carouselTags.length;
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
    if (searchActive && !favoritesOnly) return searchItems;
    const source = favoritesOnly
      ? favoriteQueries.flatMap((query) => (query.data ? [query.data] : []))
      : eventItems;
    return source.filter(
      (event) =>
        // 收藏是逐个查询的集合，搜索在集合内本地过滤；分页列表的搜索走服务端
        (!favoritesOnly || matchesEventSearch(event, filters.q)) &&
        !(discovery && heroIds.has(event.id)),
    );
  }, [
    discovery,
    eventItems,
    favoriteQueries,
    favoritesOnly,
    filters.q,
    heroIds,
    searchActive,
    searchItems,
  ]);
  // 本地榜单只在默认排序下有意义（按"最新"排的一页取前三没有"高概率"的含义）
  const localRanks = discovery && filters.sort === "volume";
  const topProbability = useMemo(
    () =>
      localRanks
        ? topByProbability(eventItems, RANK_CANDIDATES).map(
            (item) => item.event,
          )
        : [],
    [localRanks, eventItems],
  );
  const topToday = useMemo(
    () => (localRanks ? topByVolume24h(eventItems, RANK_CANDIDATES) : []),
    [localRanks, eventItems],
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
    : searchActive
      ? search.data === undefined && !search.isError
      : events.data === undefined && !events.isError;
  // 收藏视图里单个失败只提示那几个，其余照常显示；分页视图失败就是整页失败
  const listError = favoritesOnly
    ? favoriteQueries.length > 0 &&
      favoriteQueries.every((query) => query.isError)
    : searchActive
      ? search.isError
      : events.isError;
  const retry = () => {
    if (favoritesOnly) favoriteFailed.forEach((query) => void query.refetch());
    else if (searchActive) void search.refetch();
    else void events.refetch();
  };
  const refreshAll = () => {
    retry();
    if (discovery) void curated.refetch();
    if (showSeries) void seriesList.refetch();
    if (filters.parentTag) void related.refetch();
  };
  const pagination = searchActive ? search : events;

  // 一级分类行：固定"全部" + 轮播标签 + （面板选中的额外标签）+ "更多 ▾"；滚走后钉在顶部（同一份元素渲染两处）
  const tagChips = (
    <Stack testID="predict-tags">
      <HorizontalScroll>
        <TagChip
          label={t("predict.filter.all")}
          selected={filters.tag === null}
          disabled={favoritesOnly}
          onPress={() => pickPrimary(null)}
          testID="predict-tag-all"
        />
        {carouselTags.map((tag) => (
          <TagChip
            key={tag.id}
            label={pickTranslation(tag.label, locale)}
            selected={tag.id === filters.parentTag}
            disabled={favoritesOnly}
            onPress={() => pickPrimary(tag.id)}
            testID={`predict-tag-${tag.id}`}
          />
        ))}
        {extraPrimary ? (
          <TagChip
            label={pickTranslation(extraPrimary.label, locale)}
            selected
            disabled={favoritesOnly}
            onPress={() => pickPrimary(extraPrimary.id)}
            testID={`predict-tag-${extraPrimary.id}`}
          />
        ) : null}
        {showMoreTags ? (
          <TagChip
            label={`${t("predict.filter.more")} ▾`}
            selected={false}
            muted
            disabled={favoritesOnly}
            onPress={() => tagPicker.current?.present()}
            testID="predict-tag-more"
          />
        ) : null}
      </HorizontalScroll>
    </Stack>
  );
  const primaryLabel = primaryTag
    ? pickTranslation(primaryTag.label, locale)
    : t("predict.filter.all");
  const listTitle = favoritesOnly
    ? t("predict.list.myFavorites")
    : searchActive
      ? t("predict.search.markets")
      : selectedSecondary
        ? pickTranslation(selectedSecondary.label, locale)
        : filters.tag === null
          ? t("predict.list.allMarkets")
          : primaryLabel;
  // 数量只在全部翻完（没有下一页）时显示，不显示"20+"这种估数
  const listCount = favoritesOnly
    ? favoriteIds.length
    : searchActive
      ? searchTotal
      : pagination.hasNextPage
        ? null
        : eventItems.length;
  const emptyInTag =
    !favoritesOnly &&
    !searchActive &&
    filters.tag !== null &&
    !listLoading &&
    !listError &&
    listItems.length === 0 &&
    visibleSeries.length === 0;
  return (
    <CollapsingHeader
      mode="floating"
      onEndReached={loadMoreEvents}
      refresh={{
        refreshing: events.isRefetching,
        onRefresh: refreshAll,
        accessibilityLabel: t("action.refresh"),
      }}
      scrollRef={listScroll}
      contentProps={{ paddingTop: insets.top + 16, gap: "$3" }}
      collapsed={
        searching ? undefined : (
          <>
            <Stack flex={1}>{tagChips}</Stack>
            <IconButton
              label={t("predict.search.placeholder")}
              icon="magnify"
              size={32}
              onPress={scrollToTop}
              testID="predict-search-pinned"
            />
          </>
        )
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

      <Row alignItems="center" gap="$2">
        <Stack flex={1}>
          <TextField
            value={filters.q}
            onChangeText={(value) => {
              setFilters((current) => ({ ...current, q: value }));
              // 一敲字就是在搜索：不要求先点进输入框
              if (!favoritesOnly) setSearching(true);
            }}
            onFocus={() => {
              if (!favoritesOnly) setSearching(true);
            }}
            placeholder={t(
              favoritesOnly
                ? "predict.search.favorites"
                : "predict.search.placeholder",
            )}
            accessibilityLabel={t("predict.search.placeholder")}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            testID="predict-search"
          />
        </Stack>
        {searching ? (
          <TextLink
            onPress={exitSearch}
            color="$color"
            testID="predict-search-cancel"
          >
            {t("common.cancel")}
          </TextLink>
        ) : null}
      </Row>

      {searching ? null : (
        <>
          {tagChips}
          {secondaryTags.length > 0 ? (
            <Stack testID="predict-subtags">
              <HorizontalScroll>
                <SubTagChip
                  label={fill(t("predict.filter.allIn"), { tag: primaryLabel })}
                  selected={filters.tag === filters.parentTag}
                  disabled={favoritesOnly}
                  onPress={() => pickSecondary(null)}
                  testID="predict-subtag-all"
                />
                {secondaryTags.map((tag) => (
                  <SubTagChip
                    key={tag.id}
                    label={pickTranslation(tag.label, locale)}
                    selected={tag.id === filters.tag}
                    disabled={favoritesOnly}
                    onPress={() => pickSecondary(tag.id)}
                    testID={`predict-subtag-${tag.id}`}
                  />
                ))}
              </HorizontalScroll>
            </Stack>
          ) : null}
          <Row alignItems="center" gap="$2">
            <FilterSelect
              label={t("predict.filter.view")}
              value={filters.view}
              defaultValue={DEFAULT_FILTERS.view}
              options={VIEW_OPTIONS.map((view) => ({
                value: view,
                label: viewLabel(view),
              }))}
              onChange={(view) =>
                setFilters((current) => ({ ...current, view }))
              }
              closeLabel={t("common.close")}
              testID="predict-view"
            />
            <FilterSelect
              label={t("predict.filter.sort")}
              value={filters.sort}
              defaultValue={DEFAULT_FILTERS.sort}
              options={SORT_OPTIONS.map((sort) => ({
                value: sort,
                label: sortLabel(sort),
              }))}
              onChange={(sort) =>
                setFilters((current) => ({ ...current, sort }))
              }
              closeLabel={t("common.close")}
              testID="predict-sort"
            />
            <Stack flex={1} />
            <TagChip
              label={
                favoritesOnly
                  ? `★ ${fill(t("predict.filter.favoritesCount"), { n: favoriteIds.length })}`
                  : `★ ${t("predict.filter.favorites")}`
              }
              selected={favoritesOnly}
              onPress={toggleFavorites}
              testID="predict-favorites"
            />
          </Row>
          <CollapseAnchor />
          {filterSummary ? (
            <FilterBanner
              label={t("predict.filter.active")}
              summary={filterSummary}
              clearLabel={t("predict.filter.clear")}
              onClear={() =>
                setFilters((current) => ({
                  ...current,
                  view: DEFAULT_FILTERS.view,
                  sort: DEFAULT_FILTERS.sort,
                }))
              }
              testID="predict-filter-banner"
            />
          ) : null}
        </>
      )}

      {searchActive && !favoritesOnly && searchTags.length > 0 ? (
        <Stack gap="$2" testID="predict-search-tags">
          <SearchSectionTitle title={t("predict.search.tags")} />
          <HorizontalScroll>
            {searchTags.map((tag) => (
              <TagChip
                key={tag.id}
                label={pickTranslation(tag.label, locale)}
                selected={false}
                onPress={() => pickPrimary(tag.id)}
                testID={`predict-search-tag-${tag.id}`}
              />
            ))}
          </HorizontalScroll>
        </Stack>
      ) : null}

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
            if (key === "topToday")
              setFilters((current) => ({ ...current, sort: "volume24h" }));
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

      {showSeries && visibleSeries.length > 0 ? (
        <Stack gap="$2" testID="predict-series">
          <SectionTitle fontSize={14}>{t("predict.series.title")}</SectionTitle>
          {visibleSeries.map((series) => (
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

      {!(favoritesOnly && favoriteIds.length === 0) && !emptyInTag ? (
        <Row justifyContent="space-between" alignItems="baseline">
          <SectionTitle fontSize={14}>{listTitle}</SectionTitle>
          {listCount !== null ? (
            <InlineText fontSize={12} color="$textMuted">
              {fill(t("predict.filter.tagCount"), { n: listCount })}
            </InlineText>
          ) : null}
        </Row>
      ) : null}

      {favoritesOnly && favoriteIds.length === 0 ? (
        <Body testID="predict-favorites-empty">
          {t("predict.favorites.empty")}
        </Body>
      ) : emptyInTag ? (
        <EmptyTagCard
          title={fill(t("predict.list.emptyInTag"), {
            tag: selectedSecondary
              ? pickTranslation(selectedSecondary.label, locale)
              : primaryLabel,
          })}
          hint={t("predict.list.emptyHint")}
          actions={[
            {
              label: t("predict.list.gotoAll"),
              onPress: () => pickPrimary(null),
              testID: "predict-empty-all",
            },
            {
              label: t("predict.list.gotoClosed"),
              onPress: () =>
                setFilters((current) => ({ ...current, view: "closed" })),
              testID: "predict-empty-closed",
            },
          ]}
          testID="predict-empty"
        />
      ) : !listLoading && !listError ? (
        listItems.length === 0 ? (
          // 周期市场卡已经是内容时不再提示"暂无数据"
          showSeries && visibleSeries.length > 0 ? null : searchActive ? (
            <EmptyTagCard
              title={t("predict.search.empty")}
              hint={t("predict.search.hint")}
              actions={[
                {
                  label: t("predict.search.clear"),
                  onPress: exitSearch,
                  testID: "predict-search-clear",
                },
              ]}
              testID="predict-search-empty"
            />
          ) : (
            <Body>
              {filters.q.trim() ? t("predict.search.empty") : t("state.empty")}
            </Body>
          )
        ) : (
          <>
            {listItems.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                onOpen={onOpenEvent}
                onOrder={onOrder}
                orderDisabled={region.blocked}
              />
            ))}
            {!favoritesOnly ? (
              <ListFooter
                loading={pagination.isFetchingNextPage}
                error={pagination.isFetchNextPageError}
                hasMore={Boolean(pagination.hasNextPage)}
                count={listItems.length}
                onRetry={() => void pagination.fetchNextPage()}
              />
            ) : null}
          </>
        )
      ) : listError ? (
        searchActive ? (
          <Row justifyContent="center">
            <TextLink
              onPress={retry}
              color="$danger"
              testID="predict-search-error"
            >
              {t("predict.search.unavailable")}
            </TextLink>
          </Row>
        ) : (
          <Row alignItems="center" justifyContent="space-between">
            <Body color="$danger">{t("state.error")}</Body>
            <SecondaryButton height={32} onPress={retry}>
              {t("action.retryNow")}
            </SecondaryButton>
          </Row>
        )
      ) : (
        <Stack gap="$2">
          <SkeletonBlock height={150} borderRadius="$4" />
          <SkeletonBlock height={150} borderRadius="$4" />
          <SkeletonBlock height={150} borderRadius="$4" />
        </Stack>
      )}

      <PickerSheet
        ref={tagPicker}
        title={t("predict.filter.allTags")}
        count={
          allTags.data
            ? fill(t("predict.filter.tagCount"), { n: allTags.data.length })
            : undefined
        }
        searchPlaceholder={t("predict.filter.searchTags")}
        items={(allTags.data ?? []).map((tag) => ({
          id: tag.id,
          label: pickTranslation(tag.label, locale),
          badge: carouselTags.some((item) => item.id === tag.id),
        }))}
        selectedId={filters.parentTag}
        badgeLabel={t("predict.filter.common")}
        onSelect={(id) => pickPrimary(id)}
        emptyLabel={t("predict.search.empty")}
        closeLabel={t("common.close")}
        testID="predict-tag-picker"
      />
    </CollapsingHeader>
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

/** 列表分页脚注：到底自动翻页，这里只说状态；失败给一个文字链重试 */
function ListFooter({
  loading,
  error,
  hasMore,
  count,
  onRetry,
}: {
  loading: boolean;
  error: boolean;
  hasMore: boolean;
  count: number;
  onRetry: () => void;
}) {
  const { t } = useFoundationRuntime();
  if (!loading && !error && !hasMore && count === 0) return null;
  return (
    <Row
      alignItems="center"
      justifyContent="center"
      gap="$2"
      minHeight={36}
      testID="predict-list-footer"
    >
      {loading ? (
        <>
          <Spinner size="small" color="$textMuted" />
          <Body fontSize={12} color="$textMuted">
            {t("predict.list.loadingMore")}
          </Body>
        </>
      ) : error ? (
        <TextLink onPress={onRetry} color="$danger" fontSize={12}>
          {t("predict.list.loadFailed")}
        </TextLink>
      ) : hasMore ? (
        <Body fontSize={12} color="$textMuted">
          {t("predict.list.scrollForMore")}
        </Body>
      ) : (
        <Body fontSize={12} color="$textMuted">
          {fill(t("predict.list.allShown"), { n: count })}
        </Body>
      )}
    </Row>
  );
}
