import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { formatMoney, formatUsd } from "../../../core/i18n/format";
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
  useTheme,
} from "../../../design-system";
import { useSession } from "../../session/hooks/use-session";
import {
  usePredictBalance,
  usePredictEvents,
  usePredictTags,
} from "../hooks/use-predict";
import type {
  EventQuery,
  Market,
  Outcome,
  PredictEvent,
} from "../model/predict";
import { EventCard, YesNoButtons, fill } from "./shared";

/** P-01 市场列表：顶栏余额 chip、分类 chip、排序、专场 banner、三种卡型。 */
export function MarketListScreen({
  onOpenEvent,
  onOrder,
  onOpenTransfer,
  onOpenPositions,
  onOpenLeaderboard,
  showPositionsEntry,
}: {
  onOpenEvent: (event: PredictEvent, market?: Market) => void;
  onOrder: (market: Market, outcome: Outcome) => void;
  onOpenTransfer: () => void;
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
  const balance = usePredictBalance(address);
  const tags = usePredictTags();
  const [tagId, setTagId] = useState("hot");
  const [sort, setSort] = useState<NonNullable<EventQuery["sort"]>>("volume");
  const events = usePredictEvents({ tagId, sort, limit: 20 });
  const featured = usePredictEvents({ featured: true, limit: 1 });
  const banner = featured.data?.items[0];

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
                balance.data && isZero(balance.data.available) ? (
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

          <Row gap="$2">
            {(["volume", "endingSoon", "newest"] as const).map((option) => (
              <Row
                key={option}
                alignItems="center"
                gap="$1"
                paddingHorizontal="$2.5"
                paddingVertical="$1"
                borderRadius={999}
                borderWidth={1}
                borderColor={sort === option ? "$primary" : "$borderColor"}
                onPress={() => setSort(option)}
                accessibilityRole="radio"
                accessibilityState={{ selected: sort === option }}
              >
                <InlineText
                  fontSize={12}
                  fontWeight="600"
                  color={sort === option ? "$primary" : "$textMuted"}
                >
                  {t(`predict.sort.${option}`)}
                </InlineText>
              </Row>
            ))}
          </Row>

          {banner && tagId === "hot" ? (
            <Stack
              padding="$3"
              borderRadius="$4"
              gap="$2"
              style={{ backgroundColor: `${theme.primary.val}42` }}
              onPress={() => onOpenEvent(banner)}
              accessibilityRole="button"
              testID="predict-featured"
            >
              <Row alignItems="center" gap="$2">
                <AppIcon
                  name="star-four-points"
                  size={14}
                  colorToken="primary"
                />
                <InlineText fontSize={11} fontWeight="800" color="$primary">
                  {t("predict.special")} · {banner.categoryTagId.toUpperCase()}
                </InlineText>
              </Row>
              <SectionTitle>
                {pickTranslation(banner.title, locale)}
              </SectionTitle>
              {banner.markets.slice(0, 3).map((market) => (
                <Row key={market.id} alignItems="center" gap="$2">
                  <Body flex={1} color="$color" numberOfLines={1}>
                    {pickTranslation(market.outcomeLabel, locale)}
                  </Body>
                  <InlineText fontWeight="800" width={44} textAlign="right">
                    {market.yesPriceCents}%
                  </InlineText>
                  <Stack width={132}>
                    <YesNoButtons
                      yes={market.yesPriceCents}
                      compact
                      onPress={(outcome) => onOrder(market, outcome)}
                    />
                  </Stack>
                </Row>
              ))}
              <Body fontSize={11}>
                {fill(t("predict.outcomes"), { n: banner.markets.length })} ·{" "}
                {fill(t("predict.volume"), {
                  amount: formatUsd(banner.volumeUsd, locale, {
                    compact: true,
                  }),
                })}
              </Body>
            </Stack>
          ) : null}

          {events.data ? (
            events.data.items.length === 0 ? (
              <Body>{t("state.empty")}</Body>
            ) : (
              events.data.items
                .filter(
                  (event) =>
                    !(banner && tagId === "hot" && event.id === banner.id),
                )
                .map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onOpen={onOpenEvent}
                    onOrder={onOrder}
                  />
                ))
            )
          ) : events.isError ? (
            <Row alignItems="center" justifyContent="space-between">
              <Body color="$danger">{t("state.error")}</Body>
              <SecondaryButton
                height={32}
                onPress={() => void events.refetch()}
              >
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
