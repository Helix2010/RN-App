import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { formatDate, formatPercentCents } from "../../../core/i18n/format";
import { pickTranslation } from "../../../core/i18n/localized-text";
import {
  Body,
  Card,
  Content,
  DetailRow,
  InlineText,
  Page,
  PageScroll,
  PageState,
  PrimaryButton,
  Row,
  ScreenHeader,
  SecondaryButton,
  SectionTitle,
  SkeletonBlock,
  Stack,
} from "../../../design-system";
import {
  useRegionGate,
  useSeries,
  useSeriesPeriods,
} from "../hooks/use-predict";
import type { Outcome, SeriesPeriod } from "../model/predict";
import {
  periodCountdown,
  periodPhase,
  periodResultLabel,
  pickCurrentPeriod,
  priceLabel,
  useTicking,
  windowLabel,
} from "./series-card";
import { RegionNotice } from "./shared";

/**
 * 周期市场页：当期窗口（参考价、倒计时、交易入口）+ 历史窗口（参考价 / 结算价 / 涨跌）。
 * K 线与实时价流不在本轮范围，交易与盘口复用事件详情页。
 */
export function SeriesScreen({
  slug,
  id,
  onBack,
  onOpenEvent,
}: {
  slug: string;
  /** 平台系列 id：有就带上，避免同名 slug 打开别的系列 */
  id?: string;
  onBack: () => void;
  onOpenEvent: (eventId: string, marketId: string, outcome?: Outcome) => void;
}) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const series = useSeries(slug, id);
  const current = useSeriesPeriods(series.data?.id, "current", 2);
  const past = useSeriesPeriods(series.data?.id, "closed", 12);
  const now = useTicking();
  const region = useRegionGate();
  const period = current.data ? pickCurrentPeriod(current.data, now) : null;
  const phase = period ? periodPhase(period, now) : "ended";
  const live = phase === "live";
  const market = period?.event?.markets[0];

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
        <Content gap="$4" paddingBottom={40}>
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

          <Card padding="$3" gap="$2" testID="series-current">
            <SectionTitle fontSize={14}>
              {t("predict.series.current")}
            </SectionTitle>
            {current.isError ? (
              <QueryError onRetry={() => void current.refetch()} />
            ) : current.data === undefined ? (
              <SkeletonBlock height={96} />
            ) : period ? (
              <>
                <Row alignItems="center" gap="$2">
                  <InlineText
                    fontSize={11}
                    fontWeight="800"
                    color={live ? "$success" : "$textMuted"}
                  >
                    {t(`predict.series.${phase}`)}
                  </InlineText>
                  <Body fontSize={12}>{windowLabel(period, locale)}</Body>
                </Row>
                <InlineText
                  fontSize={22}
                  fontWeight="900"
                  testID="series-countdown"
                >
                  {periodCountdown(period, now, t)}
                </InlineText>
                <DetailRow
                  label={t("predict.series.priceToBeat")}
                  value={priceLabel(period.priceToBeat, locale)}
                />
                {market ? (
                  <>
                    <Row gap="$3" alignItems="center">
                      <Stack flex={1} alignItems="center">
                        <Body fontSize={11}>{t("predict.series.up")}</Body>
                        <InlineText fontWeight="900" color="$success">
                          {formatPercentCents(market.yesPriceCents)}
                        </InlineText>
                      </Stack>
                      <Stack flex={1} alignItems="center">
                        <Body fontSize={11}>{t("predict.series.down")}</Body>
                        <InlineText fontWeight="900" color="$danger">
                          {formatPercentCents(
                            market.yesPriceCents === null
                              ? null
                              : 100 - market.yesPriceCents,
                          )}
                        </InlineText>
                      </Stack>
                    </Row>
                    <RegionNotice state={region.state} onRetry={region.retry} />
                    <PrimaryButton
                      disabled={
                        !live || !market.acceptingOrders || region.blocked
                      }
                      onPress={() =>
                        period.event && onOpenEvent(period.event.id, market.id)
                      }
                      testID="series-trade"
                    >
                      {t("predict.series.trade")}
                    </PrimaryButton>
                  </>
                ) : null}
              </>
            ) : (
              <Body>{t("predict.series.noPeriods")}</Body>
            )}
          </Card>

          <Stack gap="$2">
            <SectionTitle fontSize={14}>
              {t("predict.series.past")}
            </SectionTitle>
            {past.isError ? (
              <QueryError onRetry={() => void past.refetch()} />
            ) : past.data === undefined ? (
              <SkeletonBlock height={120} />
            ) : past.data.length === 0 ? (
              <Body>{t("predict.series.noPeriods")}</Body>
            ) : (
              past.data.map((item) => (
                <PastPeriodRow key={item.id} period={item} />
              ))
            )}
          </Stack>
        </Content>
      </PageScroll>
    </Page>
  );
}

function PastPeriodRow({ period }: { period: SeriesPeriod }) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const resultLabel = periodResultLabel(period, t);
  return (
    <Row
      alignItems="center"
      gap="$3"
      paddingVertical="$2"
      borderBottomWidth={1}
      borderColor="$borderColor"
      testID={`series-period-${period.id}`}
    >
      <Stack flex={1} gap="$0.5">
        <InlineText fontSize={13} fontWeight="700">
          {windowLabel(period, locale)}
        </InlineText>
        <Body fontSize={11}>
          {formatDate(period.windowEnd, locale)} ·{" "}
          {t("predict.series.priceToBeat")}{" "}
          {priceLabel(period.priceToBeat, locale)} ·{" "}
          {t("predict.series.finalPrice")}{" "}
          {priceLabel(period.finalPrice, locale)}
        </Body>
      </Stack>
      <InlineText
        fontWeight="800"
        color={
          period.result === "up"
            ? "$success"
            : period.result === "down"
              ? "$danger"
              : "$textMuted"
        }
      >
        {resultLabel}
      </InlineText>
    </Row>
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
