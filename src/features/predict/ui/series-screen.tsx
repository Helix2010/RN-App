import { useEffect, useMemo, useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { formatCents } from "../../../core/i18n/format";
import { pickTranslation } from "../../../core/i18n/localized-text";
import {
  Body,
  Card,
  Content,
  InlineText,
  Page,
  PageScroll,
  PageState,
  Row,
  ScreenHeader,
  SecondaryButton,
  SectionTitle,
  SkeletonBlock,
  Stack,
  toast,
} from "../../../design-system";
import { useSession } from "../../session/hooks/use-session";
import {
  useClosedSeriesPeriods,
  useOrderBook,
  usePositions,
  useRegionGate,
  useSeries,
  useSeriesPeriods,
} from "../hooks/use-predict";
import type {
  Market,
  OrderSide,
  Outcome,
  SeriesPeriod,
} from "../model/predict";
import { OrderBookView } from "./order-book";
import { OrderSheet, type OrderSheetHandle } from "./order-sheet";
import {
  periodPhase,
  pickCurrentPeriod,
  rolloverDecision,
  useTicking,
  windowLabel,
} from "./series-card";
import { SeriesChart, useSeriesLivePrice } from "./series-chart";
import { SeriesPeriodCard } from "./series-period-card";
import { PeriodRow, SeriesPeriodRail } from "./series-period-rail";
import { SeriesPositionBar } from "./series-position-bar";
import { fill } from "./shared";

/** 当期 + 未来 7 期（轨道 3 期 + "更多"面板） */
const CURRENT_LIMIT = 8;
const HISTORY_PAGE = 12;

const byStart = (a: SeriesPeriod, b: SeriesPeriod) =>
  new Date(a.windowStart).getTime() - new Date(b.windowStart).getTime();

/**
 * 周期市场页（设计 predict-series-periods §4）：期轨道 → 所选期卡 → 我的仓位 → 走势 → 盘口（折叠）→ 历史。
 * 默认跟随当期；用户选了某期就固定在那一期（"回到当期"回来）；跟随时当期换了：
 * 刚结束那期有仓位就停在那看结算，没有就自动切到新当期并轻提示。下单直接拉起面板并带期上下文。
 */
export function SeriesScreen({
  slug,
  id,
  periodMarketId,
  onBack,
  onOpenEvent,
  onOpenTransfer,
}: {
  slug: string;
  /** 平台系列 id：有就带上，避免同名 slug 打开别的系列 */
  id?: string;
  /** 从持仓进来：定位到该市场对应的那一期 */
  periodMarketId?: string;
  onBack: () => void;
  onOpenEvent: (eventId: string, marketId: string) => void;
  onOpenTransfer: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const session = useSession();
  const address = session.data?.address;
  const series = useSeries(slug, id);
  const seriesId = series.data?.id;
  const current = useSeriesPeriods(seriesId, "current", CURRENT_LIMIT);
  const history = useClosedSeriesPeriods(seriesId, HISTORY_PAGE);
  const now = useTicking();
  const region = useRegionGate();
  const positions = usePositions(address, true);

  const upcoming = useMemo(
    () => [...(current.data?.items ?? [])].sort(byStart),
    [current.data],
  );
  const past = useMemo(
    () => history.data?.pages.flatMap((page) => page.items) ?? [],
    [history.data],
  );
  const all = useMemo(() => [...past, ...upcoming], [past, upcoming]);
  const currentPeriod = useMemo(
    () => pickCurrentPeriod(upcoming, now),
    [upcoming, now],
  );
  const heldMarketIds = useMemo(
    () =>
      new Set(
        (positions.data ?? [])
          .filter((position) => position.shares > 0)
          .map((position) => position.marketId),
      ),
    [positions.data],
  );

  // 用户手选的期（对象而不是 id：它翻出分页范围后仍能显示）
  const [selected, setSelected] = useState<SeriesPeriod | null>(null);
  // 翻期记录：上次看到的当期、"有仓位停留"的已结束期、要提示"已切到"的新当期
  const [track, setTrack] = useState<{
    current: SeriesPeriod | null;
    pinned: SeriesPeriod | null;
    announce: SeriesPeriod | null;
  }>({ current: null, pinned: null, announce: null });
  const pinned = track.pinned;
  const following = selected === null && pinned === null;

  // 手选的期本身成为进行中的当期 → 回到跟随，免得它结束时又卡住一次（渲染期间调整状态，不用 effect）
  if (
    selected &&
    currentPeriod &&
    selected.id === currentPeriod.id &&
    periodPhase(currentPeriod, now) === "live"
  )
    setSelected(null);

  // 跟随时当期换了：刚结束那期有仓位就停下，否则记一条"已切到"提示；提示与补拉历史在 effect 里做
  if (currentPeriod && track.current?.id !== currentPeriod.id) {
    const previous = track.current;
    const decision = previous
      ? rolloverDecision({
          following,
          endedMarketId: previous.marketId,
          heldMarketIds,
        })
      : "none";
    setTrack({
      current: currentPeriod,
      pinned: decision === "stay" ? previous : pinned,
      announce: decision === "switch" ? currentPeriod : null,
    });
  }
  const announce = track.announce;
  useEffect(() => {
    if (!announce) return;
    toast(
      fill(t("predict.series.switched"), {
        window: windowLabel(announce, locale),
      }),
    );
  }, [announce, locale, t]);
  const trackedId = track.current?.id;
  const refetchHistory = history.refetch;
  const historySeeded = useRef(false);
  useEffect(() => {
    if (!trackedId) return;
    // 首次拿到当期不用补拉；之后每次翻期把刚结束的一期补进历史列表
    if (!historySeeded.current) {
      historySeeded.current = true;
      return;
    }
    void refetchHistory();
  }, [refetchHistory, trackedId]);

  const fresh = (period: SeriesPeriod | null) =>
    period ? (all.find((item) => item.id === period.id) ?? period) : null;
  const displayed = fresh(selected) ?? fresh(pinned) ?? currentPeriod;
  const displayedPhase = displayed ? periodPhase(displayed, now) : "ended";
  const isCurrent = displayed !== null && displayed.id === currentPeriod?.id;
  const unpin = () => setTrack((state) => ({ ...state, pinned: null }));
  const backToCurrent = () => {
    setSelected(null);
    unpin();
  };

  // 倒计时归零立刻重拉分期，不等 15 秒轮询
  const refetchedFor = useRef<string | null>(null);
  const refetchCurrent = current.refetch;
  useEffect(() => {
    if (!currentPeriod) return;
    if (
      now >= new Date(currentPeriod.windowEnd).getTime() &&
      refetchedFor.current !== currentPeriod.id
    ) {
      refetchedFor.current = currentPeriod.id;
      void refetchCurrent();
    }
  }, [currentPeriod, now, refetchCurrent]);

  // 从持仓进来：数据到齐后在当期分页与历史第一页里找那一期，只做一次；找不到就留在当期并说明
  const [located, setLocated] = useState<{
    key: string;
    missing: boolean;
  } | null>(null);
  if (
    periodMarketId &&
    current.data !== undefined &&
    history.data !== undefined &&
    located?.key !== periodMarketId
  ) {
    const found = all.find((period) => period.marketId === periodMarketId);
    setLocated({ key: periodMarketId, missing: !found });
    if (found) setSelected(found);
  }
  const locateMissing = located?.missing ?? false;

  const live = useSeriesLivePrice(series.data, displayed, now);
  const market = displayed?.event?.markets[0];
  const canOrder =
    displayedPhase !== "ended" &&
    (market?.acceptingOrders ?? false) &&
    !region.blocked;
  const orderSheet = useRef<OrderSheetHandle>(null);
  const openOrder = (
    target: Market,
    outcome: Outcome,
    side: OrderSide = "buy",
    limitPriceCents?: number,
  ) => {
    if (!displayed || !series.data) return;
    orderSheet.current?.open(target, outcome, side, limitPriceCents, {
      seriesTitle: pickTranslation(series.data.title, locale),
      period: displayed,
    });
  };

  // 盘口默认折叠；标题行给买一 / 卖一，展开状态切期不收回
  const [bookOpen, setBookOpen] = useState(false);
  const [bookOutcome, setBookOutcome] = useState<Outcome>("yes");
  const book = useOrderBook(
    displayedPhase !== "ended" ? (displayed?.marketId ?? undefined) : undefined,
  );
  const [rulesOpen, setRulesOpen] = useState(false);
  const rules = displayed?.event
    ? pickTranslation(displayed.event.rules, locale)
    : null;

  if (series.isError)
    return (
      <Page>
        <PageState title={t("state.error")} />
      </Page>
    );

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={series.data ? pickTranslation(series.data.title, locale) : ""}
          onBack={onBack}
          backLabel={t("action.back")}
        />
      </Content>
      <PageScroll>
        <Content gap="$3" paddingBottom={40}>
          {series.data ? (
            <Row alignItems="center" gap="$2">
              <InlineText
                fontSize={11}
                fontWeight="800"
                paddingHorizontal="$2"
                paddingVertical="$0.5"
                borderRadius={999}
                backgroundColor="$surfaceVariant"
              >
                {series.data.recurrence}
              </InlineText>
              <Body fontSize={12}>{series.data.seriesType}</Body>
            </Row>
          ) : (
            <SkeletonBlock height={20} width={160} />
          )}

          {rules ? (
            <Row alignItems="flex-start" gap="$2" testID="series-rules">
              <Body
                fontSize={12}
                flex={1}
                numberOfLines={rulesOpen ? undefined : 1}
              >
                {t("predict.series.rulesTitle")}：{rules}
              </Body>
              <InlineText
                fontSize={12}
                fontWeight="700"
                color="$primary"
                onPress={() => setRulesOpen((open) => !open)}
                accessibilityRole="button"
                testID="series-rules-toggle"
              >
                {t(
                  rulesOpen
                    ? "predict.series.rulesHide"
                    : "predict.series.rulesShow",
                )}
              </InlineText>
            </Row>
          ) : null}

          {current.isError ? (
            <QueryError onRetry={() => void current.refetch()} />
          ) : current.data === undefined ? (
            <SkeletonBlock height={44} />
          ) : (
            <SeriesPeriodRail
              past={past}
              upcoming={upcoming}
              currentId={currentPeriod?.id ?? null}
              selectedId={displayed?.id ?? null}
              nowMs={now}
              heldMarketIds={heldMarketIds}
              onSelect={(period) => {
                unpin();
                setSelected(period);
              }}
              history={{
                hasMore: history.hasNextPage,
                loading: history.isFetchingNextPage,
                loadMore: () => void history.fetchNextPage(),
                error: history.isError,
                retry: () => void history.refetch(),
              }}
            />
          )}
          {locateMissing ? (
            <Body fontSize={12} color="$warning" testID="series-locate-missing">
              {t("predict.series.periodNotFound")}
            </Body>
          ) : null}
          {following &&
          currentPeriod &&
          periodPhase(currentPeriod, now) === "ended" ? (
            <Body fontSize={12} color="$textMuted" testID="series-waiting-next">
              {t("predict.series.waitingNext")}
            </Body>
          ) : null}

          {current.data === undefined || current.isError ? null : displayed ? (
            <SeriesPeriodCard
              period={displayed}
              phase={displayedPhase}
              nowMs={now}
              isCurrent={isCurrent}
              live={live}
              region={region}
              onOrder={(target, outcome) => openOrder(target, outcome)}
              onBackToCurrent={backToCurrent}
              onOpenDetail={() =>
                displayed.event &&
                displayed.marketId &&
                onOpenEvent(displayed.event.id, displayed.marketId)
              }
              showGoNext={
                pinned !== null &&
                currentPeriod !== null &&
                currentPeriod.id !== displayed.id
              }
              onGoNext={backToCurrent}
            />
          ) : (
            <Card padding="$3">
              <Body>{t("predict.series.noPeriods")}</Body>
            </Card>
          )}

          {displayed && address ? (
            <SeriesPositionBar period={displayed} address={address} />
          ) : null}

          {series.data ? (
            <Card padding="$3" gap="$2" testID="series-chart-card">
              <SeriesChart
                series={series.data}
                period={displayed}
                phase={displayedPhase}
                live={live}
              />
            </Card>
          ) : null}

          {displayed?.marketId && displayedPhase !== "ended" ? (
            <Card padding="$3" gap="$2" testID="series-book-card">
              <Row
                alignItems="center"
                justifyContent="space-between"
                gap="$2"
                onPress={() => setBookOpen((open) => !open)}
                accessibilityRole="button"
                accessibilityState={{ expanded: bookOpen }}
                testID="series-book-toggle"
              >
                <SectionTitle fontSize={14}>
                  {t("predict.series.book")}
                </SectionTitle>
                <Body fontSize={12}>
                  {book.data
                    ? fill(t("predict.series.bookQuote"), {
                        bid: formatCents(book.data.bids[0]?.priceCents ?? null),
                        ask: formatCents(book.data.asks[0]?.priceCents ?? null),
                      })
                    : ""}{" "}
                  {bookOpen ? "▴" : "▾"}
                </Body>
              </Row>
              {bookOpen ? (
                <OrderBookView
                  book={book.data}
                  outcome={bookOutcome}
                  onOutcomeChange={setBookOutcome}
                  onPickPrice={
                    canOrder && market
                      ? (priceCents, side) =>
                          openOrder(market, bookOutcome, side, priceCents)
                      : undefined
                  }
                />
              ) : null}
            </Card>
          ) : null}

          <Stack gap="$2">
            <SectionTitle fontSize={14}>
              {t("predict.series.past")}
            </SectionTitle>
            {history.isError && past.length === 0 ? (
              <QueryError onRetry={() => void history.refetch()} />
            ) : history.data === undefined ? (
              <SkeletonBlock height={120} />
            ) : past.length === 0 ? (
              <Body>{t("predict.series.noPeriods")}</Body>
            ) : (
              <>
                {past.map((item) => (
                  <PeriodRow
                    key={item.id}
                    period={item}
                    selected={item.id === displayed?.id}
                    onPress={() => {
                      unpin();
                      setSelected(item);
                    }}
                  />
                ))}
                {history.isError ? (
                  <QueryError onRetry={() => void history.fetchNextPage()} />
                ) : history.hasNextPage ? (
                  <SecondaryButton
                    disabled={history.isFetchingNextPage}
                    onPress={() => void history.fetchNextPage()}
                    testID="series-history-more"
                  >
                    {t("predict.series.loadEarlier")}
                  </SecondaryButton>
                ) : null}
              </>
            )}
          </Stack>
        </Content>
      </PageScroll>
      <OrderSheet
        ref={orderSheet}
        event={displayed?.event}
        onInsufficient={onOpenTransfer}
      />
    </Page>
  );
}

function QueryError({ onRetry }: { onRetry: () => void }) {
  const { t } = useFoundationRuntime();
  return (
    <Row alignItems="center" justifyContent="space-between" gap="$2">
      <Body color="$danger">{t("state.error")}</Body>
      <SecondaryButton height={32} onPress={onRetry}>
        {t("action.retryNow")}
      </SecondaryButton>
    </Row>
  );
}
