import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { formatUsd, shortenAddress } from "../../../core/i18n/format";
import {
  Body,
  Content,
  InlineText,
  Page,
  PageScroll,
  PrimaryButton,
  Row,
  ScreenHeader,
  SectionTitle,
  SegmentedControl,
  SkeletonBlock,
  Stack,
  Tabs,
} from "../../../design-system";
import { useSession } from "../../session/hooks/use-session";
import { requestAuth } from "../../session/model/auth-sheet-store";
import { useLeaderboard } from "../hooks/use-predict";
import type { LeaderboardPeriod } from "../model/predict";
import { fill } from "./shared";

/** P-06 排行榜：时间段 Tabs + 排序；底部常驻"我的排名"（游客态 → 连接钱包）。 */
export function LeaderboardScreen({
  onBack,
  onOpenPositions,
}: {
  onBack: () => void;
  onOpenPositions: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const [sort, setSort] = useState<"pnl" | "volume">("pnl");
  const rows = useLeaderboard(period, sort);
  const session = useSession();
  const address = session.data?.address;

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={t("predict.leaderboard.title")}
          onBack={onBack}
          backLabel={t("action.back")}
        />
      </Content>
      <PageScroll>
        <Content paddingTop="$1" gap="$3" paddingBottom={140}>
          <Tabs
            value={period}
            options={(["today", "week", "month", "all"] as const).map(
              (value) => ({ value, label: t(`predict.leaderboard.${value}`) }),
            )}
            onChange={setPeriod}
            accessibilityLabel={t("predict.leaderboard.title")}
          />
          <Row justifyContent="space-between" alignItems="center">
            <SegmentedControl
              value={sort}
              options={[
                { value: "pnl", label: t("predict.leaderboard.byPnl") },
                { value: "volume", label: t("predict.leaderboard.byVolume") },
              ]}
              onChange={setSort}
              accessibilityLabel={t("predict.leaderboard.byPnl")}
            />
            <Body fontSize={11}>
              {fill(t("predict.leaderboard.updated"), {
                time: locale === "zh-CN" ? "5 分钟" : "5m",
              })}
            </Body>
          </Row>
          {rows.data ? (
            rows.data.map((entry) => (
              <Row
                key={entry.address}
                alignItems="center"
                gap="$3"
                paddingVertical="$2.5"
                borderBottomWidth={1}
                borderColor="$borderColor"
                testID={`rank-${entry.rank}`}
              >
                <InlineText
                  width={22}
                  fontWeight="900"
                  color={
                    entry.rank === 1
                      ? "$primary"
                      : entry.rank <= 3
                        ? "$info"
                        : "$textMuted"
                  }
                >
                  {entry.rank}
                </InlineText>
                <Stack
                  width={36}
                  height={36}
                  borderRadius={18}
                  backgroundColor={
                    entry.rank <= 3 ? "$primary" : "$surfaceVariant"
                  }
                  alignItems="center"
                  justifyContent="center"
                >
                  <InlineText
                    fontWeight="900"
                    color={entry.rank <= 3 ? "$onPrimary" : "$color"}
                  >
                    {(entry.name ?? entry.address.slice(2, 4))
                      .slice(0, 2)
                      .toUpperCase()}
                  </InlineText>
                </Stack>
                <Stack flex={1}>
                  <SectionTitle fontSize={14}>
                    {entry.name ?? shortenAddress(entry.address)}
                  </SectionTitle>
                  <Body fontSize={12}>
                    {fill(t("predict.volume"), {
                      amount: formatUsd(entry.volumeUsd, locale),
                    })}{" "}
                    ·{" "}
                    {fill(t("predict.leaderboard.winRate"), {
                      pct: `${entry.winRatePct}%`,
                    })}
                  </Body>
                </Stack>
                <InlineText
                  fontWeight="800"
                  color={
                    entry.pnlUsd >= 0 ? "$pricePositive" : "$priceNegative"
                  }
                >
                  {formatUsd(entry.pnlUsd, locale, { sign: true })}
                </InlineText>
              </Row>
            ))
          ) : (
            <Stack gap="$2">
              <SkeletonBlock height={56} />
              <SkeletonBlock height={56} />
              <SkeletonBlock height={56} />
            </Stack>
          )}
        </Content>
      </PageScroll>
      <Stack
        position="absolute"
        left={0}
        right={0}
        bottom={0}
        padding="$4"
        paddingBottom={insets.bottom + 12}
        backgroundColor="$background"
        borderTopWidth={1}
        borderColor="$borderColor"
      >
        {address ? (
          <Row
            alignItems="center"
            gap="$3"
            padding="$3"
            borderRadius="$4"
            backgroundColor="$surfaceVariant"
          >
            <Stack
              width={36}
              height={36}
              borderRadius={18}
              backgroundColor="$primary"
              alignItems="center"
              justifyContent="center"
            >
              <InlineText fontWeight="900" color="$onPrimary">
                {address.slice(2, 4).toUpperCase()}
              </InlineText>
            </Stack>
            <Stack flex={1}>
              <SectionTitle fontSize={14}>
                {fill(t("predict.leaderboard.myRank"), { rank: "1,204" })}
              </SectionTitle>
              <Body fontSize={12}>
                {t("predict.leaderboard.weekPnl")}{" "}
                <InlineText color="$pricePositive" fontWeight="700">
                  {formatUsd(312.4, locale, { sign: true })}
                </InlineText>{" "}
                ·{" "}
                {fill(t("predict.volume"), { amount: formatUsd(4860, locale) })}
              </Body>
            </Stack>
            <PrimaryButton
              height={34}
              paddingHorizontal="$3"
              fontSize={12}
              onPress={onOpenPositions}
            >
              {t("predict.leaderboard.viewPositions")}
            </PrimaryButton>
          </Row>
        ) : (
          <PrimaryButton
            onPress={() => requestAuth()}
            testID="leaderboard-connect"
          >
            {t("predict.leaderboard.connect")}
          </PrimaryButton>
        )}
      </Stack>
    </Page>
  );
}
