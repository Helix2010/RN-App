import { ChainUnavailableNotice } from "../../wallet/ui/chain-unavailable-notice";
import * as Clipboard from "expo-clipboard";
import {
  fill,
  formatMoney,
  formatUsd,
  shortenAddress,
} from "../../../core/i18n/format";
import { useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { CHAINS, type ChainId } from "../../../core/gateways/types";
import { enabledChains } from "../../../core/wallet/config/wallet-runtime-config";
import { toApproxNumber } from "../../../core/money/money";
import {
  ActionTile,
  AmountText,
  AppIcon,
  Body,
  ChipRow,
  Content,
  InlineText,
  Label,
  Page,
  PageScroll,
  ScreenHeader,
  PrimaryButton,
  Row,
  SecondaryButton,
  SectionTitle,
  Sheet,
  type SheetHandle,
  SkeletonBlock,
  Spinner,
  Stack,
  toast,
} from "../../../design-system";
import {
  useFundRecords,
  usePredictAccountBalance,
} from "../../predict/hooks/use-predict-account";
import { useSession } from "../../session/hooks/use-session";
import { useAssetsOverview } from "../hooks/use-assets";
import { HoldingRow, useChainChips } from "./assets-screen";
import { FundRecordRow, type RecordsTab } from "./records-screen";
import {
  PendingWithdrawals,
  TransferForm,
  type TransferDirection,
} from "./transfer-form";
import {
  SplitMergeSheet,
  type SplitMergeHandle,
} from "../../predict/ui/split-merge-sheet";

/** A-03 账户详情：预测账户（三格 + 操作格 + 记录）或钱包（地址 + 按链筛选）。 */
export function AccountDetailScreen({
  kind,
  onBack,
  onOpenSend,
  onOpenSwap,
  onOpenPredictEnable,
  onOpenRecords,
}: {
  kind: "predict" | "wallet";
  onBack: () => void;
  onOpenSend: () => void;
  onOpenSwap: () => void;
  onOpenPredictEnable: () => void;
  onOpenRecords: (tab: RecordsTab) => void;
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
          action={
            <Stack
              onPress={() => onOpenRecords(kind)}
              accessibilityRole="button"
              accessibilityLabel={t("records.title")}
              hitSlop={8}
              padding="$2"
              testID="account-records"
            >
              <AppIcon name="history" size={22} colorToken="color" />
            </Stack>
          }
        />
      </Content>
      {kind === "predict" ? (
        <PredictAccount
          address={address}
          onOpenEnable={onOpenPredictEnable}
          onOpenRecords={() => onOpenRecords("predict")}
        />
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

const RECENT_RECORDS = 3;

function PredictAccount({
  address,
  onOpenEnable,
  onOpenRecords,
}: {
  address: string;
  onOpenEnable: () => void;
  onOpenRecords: () => void;
}) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const balance = usePredictAccountBalance(address || undefined);
  const records = useFundRecords(
    balance.data ? address || undefined : undefined,
  );
  const transfer = useRef<SheetHandle>(null);
  const splitSheet = useRef<SplitMergeHandle>(null);
  const [direction, setDirection] = useState<TransferDirection>("deposit");
  const openTransfer = (next: TransferDirection) => {
    setDirection(next);
    transfer.current?.present();
  };
  const safe = balance.data?.safe;
  // 账户总值 = Safe 里的 USDW（1:1 兑 USDC）；持仓市值等行情接入后再加
  const total = balance.data
    ? formatUsd(toApproxNumber(balance.data.safeBalance), locale)
    : undefined;
  const cells = [
    {
      label: t("assets.available"),
      value: balance.data ? formatMoney(balance.data.available, locale) : "—",
    },
    {
      label: t("assets.lockedInOrders"),
      value: balance.data
        ? formatMoney(balance.data.lockedInOrders, locale)
        : "—",
    },
    {
      label: t("assets.safeBalance"),
      value: balance.data ? formatMoney(balance.data.safeBalance, locale) : "—",
    },
  ];
  const recent = (records.data ?? []).slice(0, RECENT_RECORDS);
  return (
    <>
      <PageScroll
        refresh={{
          refreshing: balance.isRefetching,
          onRefresh: () => {
            void balance.refetch();
            void records.refetch();
          },
          accessibilityLabel: t("action.refresh"),
        }}
      >
        <Content paddingTop="$2" gap="$4">
          {balance.notEnabled ? (
            <Stack
              gap="$3"
              padding="$4"
              borderRadius="$4"
              backgroundColor="$surfaceVariant"
              testID="account-predict-not-enabled"
            >
              <SectionTitle fontSize={16}>
                {t("assets.enablePredict")}
              </SectionTitle>
              <Body fontSize={12}>{t("transfer.notEnabled")}</Body>
              <PrimaryButton
                onPress={onOpenEnable}
                testID="account-predict-enable"
              >
                {t("transfer.enableNow")}
              </PrimaryButton>
            </Stack>
          ) : balance.isError ? (
            <Stack gap="$2">
              <Body color="$priceNegative">
                {balance.error instanceof Error
                  ? balance.error.message
                  : String(balance.error)}
              </Body>
              <SecondaryButton onPress={() => void balance.refetch()}>
                {t("action.refresh")}
              </SecondaryButton>
            </Stack>
          ) : (
            <>
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
              <Row gap="$2">
                {cells.map((cell) => (
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
              </Row>
              <Row gap="$2">
                <ActionTile
                  label={t("assets.depositAction")}
                  icon="tray-arrow-down"
                  primary
                  onPress={() => openTransfer("deposit")}
                  testID="account-deposit"
                />
                <ActionTile
                  label={t("assets.retrieveAction")}
                  icon="tray-arrow-up"
                  onPress={() => openTransfer("withdraw")}
                  testID="account-withdraw"
                />
                <ActionTile
                  label={t("assets.splitMergeShort")}
                  icon="call-split"
                  onPress={() => splitSheet.current?.open("split")}
                  testID="account-split"
                />
                <ActionTile
                  label={t("records.title")}
                  icon="history"
                  onPress={onOpenRecords}
                  testID="account-records-tile"
                />
              </Row>
              {safe ? (
                <Row
                  alignItems="center"
                  gap="$2"
                  padding="$3"
                  borderRadius="$4"
                  backgroundColor="$surfaceVariant"
                  onPress={() =>
                    void Clipboard.setStringAsync(safe).then(() =>
                      toast(t("receive.copied"), "success"),
                    )
                  }
                  accessibilityRole="button"
                  testID="account-predict-safe"
                >
                  <AppIcon
                    name="shield-check-outline"
                    size={18}
                    colorToken="success"
                  />
                  <Body fontSize={12} flex={1}>
                    {fill(t("assets.custody"), {
                      address: shortenAddress(safe),
                    })}
                  </Body>
                  <AppIcon
                    name="content-copy"
                    size={16}
                    colorToken="textMuted"
                  />
                </Row>
              ) : null}
              <PendingWithdrawals
                address={address}
                onClaimed={() => toast(t("transfer.claimed"), "success")}
              />
              <Stack gap="$1" testID="account-recent-records">
                <Row alignItems="center" justifyContent="space-between">
                  <Label>{t("records.recent")}</Label>
                  {recent.length > 0 ? (
                    <Row
                      alignItems="center"
                      gap="$0.5"
                      onPress={onOpenRecords}
                      accessibilityRole="button"
                      testID="account-records-all"
                    >
                      <Body fontSize={12} fontWeight="700">
                        {t("records.viewAll")}
                      </Body>
                      <AppIcon
                        name="chevron-right"
                        size={16}
                        colorToken="textMuted"
                      />
                    </Row>
                  ) : null}
                </Row>
                {records.data ? (
                  recent.length === 0 ? (
                    <Body fontSize={12}>{t("records.empty.predict")}</Body>
                  ) : (
                    recent.map((record) => (
                      <FundRecordRow
                        key={record.id}
                        record={record}
                        onPress={onOpenRecords}
                      />
                    ))
                  )
                ) : records.isError ? (
                  <Body fontSize={12} color="$priceNegative">
                    {records.error instanceof Error
                      ? records.error.message
                      : String(records.error)}
                  </Body>
                ) : (
                  <SkeletonBlock height={56} />
                )}
              </Stack>
            </>
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
          onOpenEnable={onOpenEnable}
          onFinished={() => transfer.current?.dismiss()}
          onMinimize={() => transfer.current?.dismiss()}
          onOpenRecords={() => {
            transfer.current?.dismiss();
            onOpenRecords();
          }}
        />
      </Sheet>
    </>
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
  const [picked, setPicked] = useState<ChainId | "all">("all");
  const chains = enabledChains();
  const chips = useChainChips(chains);
  // 选中的链被关掉后回到"全部"，不能拿着它去问链层
  const chain = picked === "all" || chains.includes(picked) ? picked : "all";
  const overview = useAssetsOverview(address || undefined, false);
  const data = overview.data;
  const rows = (data?.rows ?? []).filter(
    (row) => chain === "all" || row.token.chain === chain,
  );
  const unavailable = (data?.unavailable ?? []).filter(
    (failure) => chain === "all" || failure.chain === chain,
  );
  const total = rows.reduce((sum, row) => sum + (row.usdValue ?? 0), 0);
  return (
    <PageScroll
      refresh={{
        refreshing: overview.isRefetching,
        onRefresh: () => overview.refetch(),
        accessibilityLabel: t("action.refresh"),
      }}
    >
      <Content paddingTop="$2" gap="$4">
        <Stack gap="$1">
          <Label>{t("assets.walletTotal")}</Label>
          {data ? (
            <Row alignItems="center" gap="$2">
              <AmountText fontSize={32} lineHeight={38}>
                {formatUsd(total, locale)}
              </AmountText>
              {data.loading ? (
                <Spinner size="small" color="$textMuted" />
              ) : null}
            </Row>
          ) : (
            <SkeletonBlock height={38} width={180} />
          )}
          <Row
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
          </Row>
        </Stack>
        <Row gap="$2">
          <ActionTile
            label={t("assets.send")}
            icon="arrow-top-right"
            primary
            onPress={onOpenSend}
            testID="wallet-send"
          />
          {config.modules.dex ? (
            <ActionTile
              label={t("assets.swap")}
              icon="swap-horizontal"
              onPress={onOpenSwap}
              testID="wallet-swap"
            />
          ) : null}
        </Row>
        {chains.length > 1 ? (
          <ChipRow
            value={chain}
            options={chips}
            onChange={setPicked}
            accessibilityLabel={t("send.network")}
            testID="wallet-chain-chip"
          />
        ) : null}
        <ChainUnavailableNotice
          failures={unavailable}
          onRetry={() => overview.refetch()}
        />
        {data ? (
          rows.length === 0 && unavailable.length === 0 ? (
            <Body>{t("state.empty")}</Body>
          ) : (
            rows.map((item) => (
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
