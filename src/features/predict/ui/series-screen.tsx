import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import {
  formatCountdown,
  formatDate,
  formatPercentCents,
  NO_QUOTE,
} from "../../../core/i18n/format";
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
  SectionTitle,
  SkeletonBlock,
  Stack,
} from "../../../design-system";
import { useSeries, useSeriesPeriods } from "../hooks/use-predict";
import type { Outcome, SeriesPeriod } from "../model/predict";
import {
  isPeriodLive,
  pickCurrentPeriod,
  useTicking,
  windowLabel,
} from "./series-card";
import { fill } from "./shared";

/**
 * 周期市场页：当期窗口（参考价、倒计时、交易入口）+ 历史窗口（参考价 / 结算价 / 涨跌）。
 * K 线与实时价流不在本轮范围，交易与盘口复用事件详情页。
 */
export function SeriesScreen({
  slug,
  onBack,
  onOpenEvent,
}: {
  slug: string;
  onBack: () => void;
  onOpenEvent: (eventId: string, marketId: string, outcome?: Outcome) => void;
}) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const series = useSeries(slug);
  const current = useSeriesPeriods(series.data?.id, "current", 2);
  const past = useSeriesPeriods(series.data?.id, "closed", 12);
  const now = useTicking();
  const period = current.data ? pickCurrentPeriod(current.data, now) : null;
  const live = period ? isPeriodLive(period, now) : false;
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
            {current.data === undefined ? (
              <SkeletonBlock height={96} />
            ) : period ? (
              <>
                <Row alignItems="center" gap="$2">
                  <InlineText
                    fontSize={11}
                    fontWeight="800"
                    color={live ? "$success" : "$textMuted"}
                  >
                    {t(
                      live ? "predict.series.live" : "predict.series.upcoming",
                    )}
                  </InlineText>
                  <Body fontSize={12}>{windowLabel(period, locale)}</Body>
                </Row>
                <InlineText
                  fontSize={22}
                  fontWeight="900"
                  testID="series-countdown"
                >
                  {fill(
                    t(
                      live
                        ? "predict.series.endsIn"
                        : "predict.series.startsIn",
                    ),
                    {
                      time: formatCountdown(
                        live ? period.windowEnd : period.windowStart,
                        now,
                      ),
                    },
                  )}
                </InlineText>
                <DetailRow
                  label={t("predict.series.priceToBeat")}
                  value={
                    period.priceToBeat ? period.priceToBeat.price : NO_QUOTE
                  }
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
                    <PrimaryButton
                      disabled={!live || !market.acceptingOrders}
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
            {past.data === undefined ? (
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
  const resultLabel =
    period.result === "up"
      ? t("predict.series.up")
      : period.result === "down"
        ? t("predict.series.down")
        : t("predict.series.pending");
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
          {period.priceToBeat?.price ?? NO_QUOTE} ·{" "}
          {t("predict.series.finalPrice")}{" "}
          {period.finalPrice?.price ?? NO_QUOTE}
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
