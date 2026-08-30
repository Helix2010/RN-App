import { useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { CHAINS, type ChainId } from "../../../core/gateways/types";
import { formatDate, formatMoney } from "../../../core/i18n/format";
import { mockNow } from "../../../core/mock/mock-runtime";
import {
  Body,
  Content,
  IconButton,
  InlineText,
  Page,
  PageScroll,
  Row,
  ScreenHeader,
  SecondaryButton,
  SectionTitle,
  SegmentedControl,
  SkeletonBlock,
  Stack,
  Tabs,
} from "../../../design-system";
import { useSession } from "../../session/hooks/use-session";
import { useSwaps } from "../hooks/use-dex";
import type { SwapRecord } from "../model/dex";
import { TokenAvatar, chainName } from "./shared";

/** D-05 兑换记录：三态过滤、链过滤、按日期分组；失败项行内写原因。 */
export function SwapHistoryScreen({
  onBack,
  onOpenApprovals,
}: {
  onBack: () => void;
  onOpenApprovals: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const session = useSession();
  const [status, setStatus] = useState<
    "all" | "pending" | "confirmed" | "failed"
  >("all");
  const [chain, setChain] = useState<ChainId | "all">("all");
  const swaps = useSwaps(session.data?.address, {
    status: status === "all" ? undefined : status,
    chain: chain === "all" ? undefined : chain,
  });

  const groups = new Map<string, SwapRecord[]>();
  for (const record of swaps.data ?? []) {
    const label = dayLabel(record.at, locale, t);
    groups.set(label, [...(groups.get(label) ?? []), record]);
  }

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={t("swap.history")}
          onBack={onBack}
          backLabel={t("action.back")}
          action={
            <IconButton
              label={t("approvals.title")}
              icon="shield-key-outline"
              size={30}
              onPress={onOpenApprovals}
            />
          }
        />
      </Content>
      <PageScroll
        refresh={{
          refreshing: swaps.isRefetching,
          onRefresh: () => void swaps.refetch(),
          accessibilityLabel: t("action.refresh"),
        }}
      >
        <Content paddingTop="$1" gap="$3">
          <Tabs
            value={status}
            options={(["all", "pending", "confirmed", "failed"] as const).map(
              (value) => ({ value, label: t(`swap.filter.${value}`) }),
            )}
            onChange={setStatus}
            accessibilityLabel={t("swap.history")}
          />
          <SegmentedControl
            value={chain}
            options={[
              { value: "all" as const, label: t("dex.allChains") },
              ...(Object.keys(CHAINS) as ChainId[]).map((id) => ({
                value: id,
                label: CHAINS[id].name,
              })),
            ]}
            onChange={setChain}
            accessibilityLabel={t("send.network")}
          />
          {swaps.data ? (
            swaps.data.length === 0 ? (
              <Body>{t("state.empty")}</Body>
            ) : (
              [...groups.entries()].map(([label, records]) => (
                <Stack key={label} gap="$1">
                  <Body fontSize={12}>{label}</Body>
                  {records.map((record) => (
                    <SwapRow key={record.id} record={record} locale={locale} />
                  ))}
                </Stack>
              ))
            )
          ) : (
            <Stack gap="$2">
              <SkeletonBlock height={64} />
              <SkeletonBlock height={64} />
            </Stack>
          )}
          <SecondaryButton onPress={onOpenApprovals} testID="history-approvals">
            {t("approvals.title")}
          </SecondaryButton>
        </Content>
      </PageScroll>
    </Page>
  );
}

function dayLabel(
  iso: string,
  locale: string,
  t: (key: string) => string,
): string {
  const day = new Date(iso).toDateString();
  const now = mockNow();
  if (day === new Date(now).toDateString()) return t("swap.today");
  if (day === new Date(now - 86_400_000).toDateString())
    return t("swap.yesterday");
  return formatDate(iso, locale);
}

function SwapRow({ record, locale }: { record: SwapRecord; locale: string }) {
  const { t } = useFoundationRuntime();
  const tone =
    record.status === "confirmed"
      ? "$success"
      : record.status === "failed"
        ? "$danger"
        : "$info";
  const statusKey =
    record.status === "confirmed" || record.status === "failed"
      ? record.status
      : record.status === "confirming"
        ? "confirming"
        : "submitted";
  return (
    <Stack
      paddingVertical="$2.5"
      borderBottomWidth={1}
      borderColor="$borderColor"
      gap="$1"
      testID={`swap-${record.id}`}
    >
      <Row alignItems="center" gap="$3">
        <Stack width={44} height={36}>
          <Stack position="absolute" left={0} top={0}>
            <TokenAvatar token={record.sellToken} size={28} />
          </Stack>
          <Stack position="absolute" left={16} top={8}>
            <TokenAvatar token={record.buyToken} size={28} />
          </Stack>
        </Stack>
        <Stack flex={1} gap="$0.5">
          <SectionTitle fontSize={14}>
            {record.sellToken.symbol} → {record.buyToken.symbol}
          </SectionTitle>
          <Body fontSize={12}>
            {formatMoney(record.amountIn, locale, { maxFraction: 4 })} →{" "}
            {record.amountOut
              ? formatMoney(record.amountOut, locale, { maxFraction: 4 })
              : "—"}
          </Body>
        </Stack>
        <Stack alignItems="flex-end" gap="$0.5">
          <InlineText fontSize={12} fontWeight="800" color={tone}>
            {t(`swap.status.${statusKey}`)}
          </InlineText>
          <Body fontSize={11}>
            {new Date(record.at).toTimeString().slice(0, 5)} ·{" "}
            {chainName(record.chain)}
          </Body>
        </Stack>
      </Row>
      {record.status === "failed" && record.reasonKey ? (
        <Body fontSize={12} color="$danger" paddingLeft={56}>
          {t(record.reasonKey)}
        </Body>
      ) : null}
    </Stack>
  );
}
