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
import {
  enabledChains,
  isChainEnabled,
} from "../../../core/wallet/config/wallet-runtime-config";
import { toApproxNumber } from "../../../core/money/money";
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
  PrimaryButton,
  SecondaryButton,
  SectionTitle,
  SegmentedControl,
  Sheet,
  type SheetHandle,
  SkeletonBlock,
  Stack,
  toast,
} from "../../../design-system";
import { usePredictAccountBalance } from "../../predict/hooks/use-predict-account";
import { useSession } from "../../session/hooks/use-session";
import { useWalletBalances } from "../../wallet/hooks/use-wallet";
import { HoldingRow } from "./assets-screen";
import {
  PendingWithdrawals,
  TransferForm,
  type TransferDirection,
} from "./transfer-form";
import {
  SplitMergeSheet,
  type SplitMergeHandle,
} from "../../predict/ui/split-merge-sheet";

/** A-03 账户详情：预测账户（三格 + 资金记录）或钱包（地址 + 按链筛选）。 */
export function AccountDetailScreen({
  kind,
  onBack,
  onOpenSend,
  onOpenSwap,
  onOpenPredictEnable,
}: {
  kind: "predict" | "wallet";
  onBack: () => void;
  onOpenSend: () => void;
  onOpenSwap: () => void;
  onOpenPredictEnable: () => void;
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
        <PredictAccount address={address} onOpenEnable={onOpenPredictEnable} />
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

function PredictAccount({
  address,
  onOpenEnable,
}: {
  address: string;
  onOpenEnable: () => void;
}) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const balance = usePredictAccountBalance(address || undefined);
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
  return (
    <>
      <PageScroll
        refresh={{
          refreshing: balance.isRefetching,
          onRefresh: () => void balance.refetch(),
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
              <Stack flexDirection="row" gap="$2">
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
              {safe ? (
                <Stack
                  flexDirection="row"
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
                </Stack>
              ) : null}
              <PendingWithdrawals
                address={address}
                emptyLabel={t("transfer.noPending")}
                onClaimed={() => toast(t("transfer.claimed"), "success")}
              />
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
  // 选中的链被关掉后回到"全部"，不能拿着它去问链层
  const chain = picked === "all" || isChainEnabled(picked) ? picked : "all";
  const balances = useWalletBalances(
    address || undefined,
    chain === "all" ? undefined : chain,
  );
  const total = (balances.data?.items ?? []).reduce(
    (sum, item) => sum + (item.usdValue ?? 0),
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
            // 只列租户启用的链：关掉的链在这里出现会是一个永远为空的筛选项
            ...enabledChains().map((id) => ({
              value: id,
              label: CHAINS[id].name,
            })),
          ]}
          onChange={setPicked}
          accessibilityLabel={t("send.network")}
        />
        <ChainUnavailableNotice
          failures={balances.data?.unavailable ?? []}
          onRetry={() => void balances.refetch()}
        />
        {balances.data ? (
          balances.data.items.length === 0 &&
          balances.data.unavailable.length === 0 ? (
            <Body>{t("state.empty")}</Body>
          ) : (
            balances.data.items.map((item) => (
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
