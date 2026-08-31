import * as Clipboard from "expo-clipboard";
import { useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { CHAINS, type ChainId } from "../../../core/gateways/types";
import {
  formatDateTime,
  formatMoney,
  formatUsd,
  shortenAddress,
} from "../../../core/i18n/format";
import { pickTranslation } from "../../../core/i18n/localized-text";
import { isNegative } from "../../../core/money/money";
import {
  AmountText,
  AppIcon,
  Body,
  Content,
  InlineText,
  Label,
  Page,
  PageScroll,
  ScreenHeader,
  SecondaryButton,
  SectionTitle,
  SegmentedControl,
  Sheet,
  type SheetHandle,
  SkeletonBlock,
  Stack,
  Tabs,
  toast,
} from "../../../design-system";
import {
  usePredictActivity,
  usePredictBalance,
} from "../../predict/hooks/use-predict";
import type { Activity } from "../../predict/model/predict";
import { EVENTS } from "../../predict/fixtures/events";
import { useSession } from "../../session/hooks/use-session";
import { useWalletBalances } from "../../wallet/hooks/use-wallet";
import { HoldingRow } from "./assets-screen";
import { TransferForm, type TransferDirection } from "./transfer-form";
import {
  SplitMergeSheet,
  type SplitMergeHandle,
} from "../../predict/ui/split-merge-sheet";

const PREDICT_CONTRACT = "0x8a1c4e0b2d7f9a3c5e6b8d0f1a2c3e4d5f6a7f042";

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, value),
    template,
  );
}

/** A-03 账户详情：预测账户（三格 + 资金记录）或钱包（地址 + 按链筛选）。 */
export function AccountDetailScreen({
  kind,
  onBack,
  onOpenSend,
  onOpenSwap,
}: {
  kind: "predict" | "wallet";
  onBack: () => void;
  onOpenSend: () => void;
  onOpenSwap: () => void;
}) {
  const { t } = useFoundationRuntime();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const address = session.data?.address ?? "";
  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={
            kind === "predict" ? t("assets.predictAccount") : t("assets.wallet")
          }
          onBack={onBack}
          backLabel={t("action.back")}
        />
      </Content>
      {kind === "predict" ? (
        <PredictAccount address={address} />
      ) : (
        <WalletAccount
          address={address}
          onOpenSend={onOpenSend}
          onOpenSwap={onOpenSwap}
        />
      )}
    </Page>
  );
}

function PredictAccount({ address }: { address: string }) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const balance = usePredictBalance(address || undefined);
  const activity = usePredictActivity(address || undefined);
  const [tab, setTab] = useState<"activity" | "claims">("activity");
  const transfer = useRef<SheetHandle>(null);
  const splitSheet = useRef<SplitMergeHandle>(null);
  const [direction, setDirection] = useState<TransferDirection>("deposit");
  const openTransfer = (next: TransferDirection) => {
    setDirection(next);
    transfer.current?.present();
  };
  const rows = (activity.data ?? []).filter(
    (item) => tab === "activity" || item.type === "REDEEM",
  );
  const total = balance.data
    ? formatUsd(
        Number(balance.data.available.raw) / 1e6 +
          Number(balance.data.lockedInOrders.raw) / 1e6 +
          Number(balance.data.positionsValue.raw) / 1e6,
        locale,
      )
    : undefined;
  return (
    <>
      <PageScroll
        refresh={{
          refreshing: balance.isRefetching,
          onRefresh: () =>
            void Promise.all([balance.refetch(), activity.refetch()]),
          accessibilityLabel: t("action.refresh"),
        }}
      >
        <Content paddingTop="$2" gap="$4">
          <Stack gap="$1">
            <Label>{t("assets.accountTotal")}</Label>
            {total ? (
              <AmountText fontSize={32} lineHeight={38}>
                {total}
              </AmountText>
            ) : (
              <SkeletonBlock height={38} width={180} />
            )}
          </Stack>
          <Stack flexDirection="row" gap="$2">
            {[
              {
                label: t("assets.available"),
                value: balance.data
                  ? formatMoney(balance.data.available, locale)
                  : "—",
              },
              {
                label: t("assets.lockedInOrders"),
                value: balance.data
                  ? formatMoney(balance.data.lockedInOrders, locale)
                  : "—",
              },
              {
                label: t("assets.positionsValue"),
                value: balance.data
                  ? formatMoney(balance.data.positionsValue, locale)
                  : "—",
              },
            ].map((cell) => (
              <Stack
                key={cell.label}
                flex={1}
                padding="$3"
                borderRadius="$4"
                backgroundColor="$surfaceVariant"
                gap="$1"
              >
                <Body fontSize={11}>{cell.label}</Body>
                <InlineText fontWeight="800" fontSize={13}>
                  {cell.value}
                </InlineText>
              </Stack>
            ))}
          </Stack>
          <Stack flexDirection="row" gap="$2">
            <SecondaryButton
              flex={1}
              onPress={() => openTransfer("deposit")}
              testID="account-deposit"
            >
              {t("assets.transferAction")}
            </SecondaryButton>
            <SecondaryButton
              flex={1}
              onPress={() => openTransfer("withdraw")}
              testID="account-withdraw"
            >
              {t("assets.withdrawToWallet")}
            </SecondaryButton>
            <SecondaryButton
              flex={1}
              onPress={() => splitSheet.current?.open("split")}
              testID="account-split"
            >
              {t("assets.splitMerge")}
            </SecondaryButton>
          </Stack>
          <Stack
            flexDirection="row"
            alignItems="center"
            gap="$2"
            padding="$3"
            borderRadius="$4"
            backgroundColor="$surfaceVariant"
            onPress={() =>
              void Clipboard.setStringAsync(PREDICT_CONTRACT).then(() =>
                toast(t("receive.copied"), "success"),
              )
            }
            accessibilityRole="button"
          >
            <AppIcon
              name="shield-check-outline"
              size={18}
              colorToken="success"
            />
            <Body fontSize={12} flex={1}>
              {fill(t("assets.custody"), {
                address: shortenAddress(PREDICT_CONTRACT),
              })}
            </Body>
            <AppIcon name="content-copy" size={16} colorToken="textMuted" />
          </Stack>
          <Tabs
            value={tab}
            options={[
              { value: "activity", label: t("assets.activity") },
              { value: "claims", label: t("assets.claims") },
            ]}
            onChange={setTab}
            accessibilityLabel={t("assets.activity")}
          />
          {activity.data ? (
            rows.length === 0 ? (
              <Body>{t("state.empty")}</Body>
            ) : (
              rows.map((item) => (
                <ActivityRow key={item.id} item={item} locale={locale} />
              ))
            )
          ) : (
            <Stack gap="$2">
              <SkeletonBlock height={56} />
              <SkeletonBlock height={56} />
              <SkeletonBlock height={56} />
            </Stack>
          )}
        </Content>
      </PageScroll>
      <SplitMergeSheet ref={splitSheet} address={address || undefined} />
      <Sheet
        ref={transfer}
        title={t("transfer.title")}
        closeLabel={t("common.close")}
        scroll
      >
        <TransferForm
          key={direction}
          address={address}
          initialDirection={direction}
          onFinished={() => transfer.current?.dismiss()}
          onMinimize={() => transfer.current?.dismiss()}
        />
      </Sheet>
    </>
  );
}

function ActivityRow({ item, locale }: { item: Activity; locale: string }) {
  const event = item.eventId
    ? EVENTS.find((entry) => entry.id === item.eventId)
    : undefined;
  const negative = isNegative(item.amount);
  return (
    <Stack
      flexDirection="row"
      alignItems="center"
      gap="$3"
      paddingVertical="$2.5"
      borderBottomWidth={1}
      borderColor="$borderColor"
    >
      <Stack flex={1} gap="$0.5">
        <SectionTitle fontSize={14}>
          {pickTranslation(item.title, locale)}
        </SectionTitle>
        {event ? (
          <Body fontSize={12} numberOfLines={1}>
            {pickTranslation(event.title, locale)}
          </Body>
        ) : null}
        <Body fontSize={11}>
          {formatDateTime(item.at, locale)}
          {item.detail ? ` · ${pickTranslation(item.detail, locale)}` : ""}
        </Body>
      </Stack>
      <InlineText
        fontWeight="800"
        color={negative ? "$color" : "$pricePositive"}
        fontVariant={["tabular-nums"]}
      >
        {negative ? "−" : "+"}
        {formatMoney(
          { ...item.amount, raw: item.amount.raw.replace("-", "") },
          locale,
        )}
      </InlineText>
    </Stack>
  );
}

function WalletAccount({
  address,
  onOpenSend,
  onOpenSwap,
}: {
  address: string;
  onOpenSend: () => void;
  onOpenSwap: () => void;
}) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const [chain, setChain] = useState<ChainId | "all">("all");
  const balances = useWalletBalances(
    address || undefined,
    chain === "all" ? undefined : chain,
  );
  const total = (balances.data ?? []).reduce(
    (sum, item) => sum + item.usdValue,
    0,
  );
  return (
    <PageScroll
      refresh={{
        refreshing: balances.isRefetching,
        onRefresh: () => void balances.refetch(),
        accessibilityLabel: t("action.refresh"),
      }}
    >
      <Content paddingTop="$2" gap="$4">
        <Stack gap="$1">
          <Label>{t("assets.walletTotal")}</Label>
          {balances.data ? (
            <AmountText fontSize={32} lineHeight={38}>
              {formatUsd(total, locale)}
            </AmountText>
          ) : (
            <SkeletonBlock height={38} width={180} />
          )}
          <Stack
            flexDirection="row"
            alignItems="center"
            gap="$1"
            onPress={() =>
              void Clipboard.setStringAsync(address).then(() =>
                toast(t("receive.copied"), "success"),
              )
            }
            accessibilityRole="button"
            accessibilityLabel={t("account.copy")}
          >
            <Body fontSize={12}>{shortenAddress(address, 10, 4)}</Body>
            <AppIcon name="content-copy" size={14} colorToken="textMuted" />
          </Stack>
        </Stack>
        <Stack flexDirection="row" gap="$2">
          <SecondaryButton flex={1} onPress={onOpenSend}>
            {t("assets.send")}
          </SecondaryButton>
          {config.modules.dex ? (
            <SecondaryButton flex={1} onPress={onOpenSwap}>
              {t("assets.swap")}
            </SecondaryButton>
          ) : null}
        </Stack>
        <SegmentedControl
          value={chain}
          options={[
            { value: "all" as const, label: t("assets.allChains") },
            ...(Object.keys(CHAINS) as ChainId[]).map((id) => ({
              value: id,
              label: CHAINS[id].name,
            })),
          ]}
          onChange={setChain}
          accessibilityLabel={t("send.network")}
        />
        {balances.data ? (
          balances.data.length === 0 ? (
            <Body>{t("state.empty")}</Body>
          ) : (
            balances.data.map((item) => (
              <HoldingRow
                key={`${item.token.chain}:${item.token.address}`}
                item={item}
                note={CHAINS[item.token.chain].name}
                locale={locale}
              />
            ))
          )
        ) : (
          <Stack gap="$2">
            <SkeletonBlock height={56} />
            <SkeletonBlock height={56} />
          </Stack>
        )}
      </Content>
    </PageScroll>
  );
}
