import * as Clipboard from "expo-clipboard";
import { useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import type { Tx } from "../../../core/gateways/types";
import {
  formatDateTime,
  formatMoney,
  formatTokenAmount,
  shortenAddress,
} from "../../../core/i18n/format";
import {
  AppIcon,
  Body,
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
  Sheet,
  SkeletonBlock,
  Spinner,
  Stack,
  Tabs,
  toast,
  type AppIconName,
  type SheetHandle,
} from "../../../design-system";
import { useFundRecords } from "../../predict/hooks/use-predict-account";
import type {
  FundRecord,
  FundRecordStatus,
} from "../../predict/model/fund-record";
import { useSession } from "../../session/hooks/use-session";
import { requestAuth } from "../../session/model/auth-sheet-store";
import { useWalletTransfers } from "../../wallet/hooks/use-wallet";
import type { WalletTransfer } from "../../wallet/model/wallet";

export type RecordsTab = "predict" | "wallet";

const KIND_ICON: Record<FundRecord["kind"], AppIconName> = {
  deposit: "tray-arrow-down",
  withdraw: "tray-arrow-up",
  claim: "check-decagram-outline",
};

const STATUS_TONE: Record<
  FundRecordStatus,
  "textMuted" | "primary" | "success" | "danger"
> = {
  pending: "textMuted",
  waiting: "textMuted",
  claimable: "primary",
  confirmed: "success",
  claimed: "success",
  failed: "danger",
};

/** 钱包交易状态 → 记录状态：签名 / 提交 / 等待出块都是"处理中" */
function walletStatus(status: Tx["status"]): FundRecordStatus {
  if (status === "confirmed") return "confirmed";
  if (status === "failed") return "failed";
  return "pending";
}

function StatusBadge({ status }: { status: FundRecordStatus }) {
  const { t } = useFoundationRuntime();
  const tone = STATUS_TONE[status];
  const color =
    tone === "primary"
      ? "$primary"
      : tone === "success"
        ? "$success"
        : tone === "danger"
          ? "$danger"
          : "$textMuted";
  return (
    <Row alignItems="center" gap="$1">
      {status === "pending" || status === "waiting" ? (
        <Spinner size="small" color={color} />
      ) : null}
      <InlineText fontSize={11} fontWeight="700" color={color}>
        {t(`records.status.${status}`)}
      </InlineText>
    </Row>
  );
}

/** 一条资金记录：左图标，中标题 + 时间 + 状态，右金额（入账为正）。 */
export function FundRecordRow({
  record,
  onPress,
}: {
  record: FundRecord;
  onPress?: () => void;
}) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  // 转入是钱包出、预测账户进；取回 / 领取反过来。这里按"钱包视角"标正负
  // 以预测账户为视角：转入 +、取回 −；领取是 USDC 回到钱包（+，绿色）
  const outgoing = record.kind === "withdraw";
  const inflowToWallet = record.kind === "claim";
  return (
    <Row
      alignItems="center"
      gap="$3"
      paddingVertical="$2.5"
      borderBottomWidth={1}
      borderColor="$borderColor"
      onPress={onPress}
      accessibilityRole={onPress ? "button" : undefined}
      testID={`record-${record.id}`}
    >
      <Stack
        width={36}
        height={36}
        borderRadius={18}
        backgroundColor="$surfaceVariant"
        alignItems="center"
        justifyContent="center"
      >
        <AppIcon
          name={KIND_ICON[record.kind]}
          size={20}
          colorToken={record.status === "failed" ? "danger" : "color"}
        />
      </Stack>
      <Stack flex={1} gap="$0.5">
        <SectionTitle fontSize={14}>
          {t(`records.kind.${record.kind}`)}
        </SectionTitle>
        <Row alignItems="center" gap="$2">
          <Body fontSize={11}>{formatDateTime(record.createdAt, locale)}</Body>
          <StatusBadge status={record.status} />
        </Row>
      </Stack>
      <InlineText
        fontWeight="800"
        color={
          record.status === "failed"
            ? "$textMuted"
            : inflowToWallet
              ? "$pricePositive"
              : "$color"
        }
        textDecorationLine={
          record.status === "failed" ? "line-through" : "none"
        }
      >
        {outgoing ? "−" : "+"}
        {formatMoney(record.amount, locale)}
      </InlineText>
    </Row>
  );
}

function WalletTransferRow({
  transfer,
  onPress,
}: {
  transfer: WalletTransfer;
  onPress?: () => void;
}) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const status = walletStatus(transfer.status);
  const outgoing = transfer.kind === "send";
  return (
    <Row
      alignItems="center"
      gap="$3"
      paddingVertical="$2.5"
      borderBottomWidth={1}
      borderColor="$borderColor"
      onPress={onPress}
      accessibilityRole={onPress ? "button" : undefined}
      testID={`record-${transfer.id}`}
    >
      <Stack
        width={36}
        height={36}
        borderRadius={18}
        backgroundColor="$surfaceVariant"
        alignItems="center"
        justifyContent="center"
      >
        <AppIcon
          name={outgoing ? "arrow-top-right" : "arrow-bottom-left"}
          size={20}
          colorToken={status === "failed" ? "danger" : "color"}
        />
      </Stack>
      <Stack flex={1} gap="$0.5">
        <SectionTitle fontSize={14}>
          {t(`records.kind.${transfer.kind}`)} · {transfer.token.symbol}
        </SectionTitle>
        <Row alignItems="center" gap="$2">
          <Body fontSize={11}>
            {formatDateTime(transfer.updatedAt, locale)} ·{" "}
            {shortenAddress(transfer.counterparty)}
          </Body>
          <StatusBadge status={status} />
        </Row>
      </Stack>
      <InlineText
        fontWeight="800"
        color={
          status === "failed"
            ? "$textMuted"
            : outgoing
              ? "$color"
              : "$pricePositive"
        }
      >
        {outgoing ? "−" : "+"}
        {formatTokenAmount(
          transfer.amount,
          transfer.token.displayDecimals,
          locale,
        )}
      </InlineText>
    </Row>
  );
}

type Detail =
  | { kind: "fund"; record: FundRecord }
  | { kind: "wallet"; transfer: WalletTransfer };

/**
 * 记录页：划转（转入 / 取回 / 领取，本机 ∪ 平台索引）与钱包转账（本机发起的转出 +
 * 账本里的收款）。点一行看详情：哈希可复制、解包请求号、可领取时间、失败原因。
 */
export function RecordsScreen({
  initialTab,
  onBack,
}: {
  initialTab?: RecordsTab;
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const session = useSession();
  const address = session.data?.address;
  const predictOn = config.modules.predict;
  const [tab, setTab] = useState<RecordsTab>(
    initialTab ?? (predictOn ? "predict" : "wallet"),
  );
  const fund = useFundRecords(predictOn ? address : undefined);
  const transfers = useWalletTransfers(address);
  const detail = useRef<SheetHandle>(null);
  const [selected, setSelected] = useState<Detail | null>(null);
  const open = (next: Detail) => {
    setSelected(next);
    detail.current?.present();
  };
  const copy = (value: string) =>
    void Clipboard.setStringAsync(value).then(() =>
      toast(t("receive.copied"), "success"),
    );
  const effectiveTab: RecordsTab = predictOn ? tab : "wallet";

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={t("records.title")}
          onBack={onBack}
          backLabel={t("action.back")}
        />
      </Content>
      {!address ? (
        <PageState
          title={t("assets.signInToView")}
          action={
            <PrimaryButton onPress={() => requestAuth()}>
              {t("home.connectWallet")}
            </PrimaryButton>
          }
        />
      ) : (
        <PageScroll
          refresh={{
            refreshing: fund.isRefetching || transfers.isRefetching,
            onRefresh: () => {
              void fund.refetch();
              void transfers.refetch();
            },
            accessibilityLabel: t("action.refresh"),
          }}
        >
          <Content paddingTop="$1" gap="$3">
            {predictOn ? (
              <Tabs
                value={effectiveTab}
                options={[
                  { value: "predict", label: t("records.tab.predict") },
                  { value: "wallet", label: t("records.tab.wallet") },
                ]}
                onChange={setTab}
                accessibilityLabel={t("records.title")}
              />
            ) : null}
            {effectiveTab === "predict" ? (
              fund.data ? (
                fund.data.length === 0 ? (
                  <Body testID="records-empty">
                    {t("records.empty.predict")}
                  </Body>
                ) : (
                  fund.data.map((record) => (
                    <FundRecordRow
                      key={record.id}
                      record={record}
                      onPress={() => open({ kind: "fund", record })}
                    />
                  ))
                )
              ) : fund.isError ? (
                <Body color="$priceNegative" fontSize={12}>
                  {fund.error instanceof Error
                    ? fund.error.message
                    : String(fund.error)}
                </Body>
              ) : (
                <Stack gap="$2">
                  <SkeletonBlock height={56} />
                  <SkeletonBlock height={56} />
                </Stack>
              )
            ) : (
              <>
                <Row alignItems="flex-start" gap="$2">
                  <AppIcon
                    name="information-outline"
                    size={16}
                    colorToken="textMuted"
                  />
                  <Body fontSize={12} flex={1}>
                    {t("records.receiveNote")}
                  </Body>
                </Row>
                {transfers.data ? (
                  transfers.data.length === 0 ? (
                    <Body testID="records-empty">
                      {t("records.empty.wallet")}
                    </Body>
                  ) : (
                    transfers.data.map((transfer) => (
                      <WalletTransferRow
                        key={transfer.id}
                        transfer={transfer}
                        onPress={() => open({ kind: "wallet", transfer })}
                      />
                    ))
                  )
                ) : (
                  <Stack gap="$2">
                    <SkeletonBlock height={56} />
                    <SkeletonBlock height={56} />
                  </Stack>
                )}
              </>
            )}
          </Content>
        </PageScroll>
      )}
      <Sheet
        ref={detail}
        title={t("records.detail")}
        closeLabel={t("common.close")}
        testID="record-detail"
      >
        {selected?.kind === "fund" ? (
          <Stack>
            <DetailRow
              label={t("records.title")}
              value={t(`records.kind.${selected.record.kind}`)}
            />
            <DetailRow
              label={t("state.status")}
              value={<StatusBadge status={selected.record.status} />}
            />
            <DetailRow
              label={t("transfer.amount")}
              value={formatMoney(selected.record.amount, locale)}
            />
            <DetailRow
              label={t("records.time")}
              value={formatDateTime(selected.record.createdAt, locale, {
                withYear: true,
              })}
            />
            {selected.record.step ? (
              <DetailRow
                label={t("records.step")}
                value={t(`transfer.step.${selected.record.step}`)}
              />
            ) : null}
            {selected.record.claimableAt ? (
              <DetailRow
                label={t("records.claimableAt")}
                value={formatDateTime(selected.record.claimableAt, locale, {
                  withYear: true,
                })}
              />
            ) : null}
            {selected.record.requestId ? (
              <DetailRow
                label={t("records.requestId")}
                value={`#${selected.record.requestId}${selected.record.source === "local" ? ` · ${t("records.indexing")}` : ""}`}
              />
            ) : null}
            {selected.record.hash ? (
              <DetailRow
                label={t("records.hash")}
                value={
                  <Row
                    alignItems="center"
                    gap="$1"
                    onPress={() => copy(selected.record.hash ?? "")}
                    accessibilityRole="button"
                    accessibilityLabel={t("account.copy")}
                  >
                    <InlineText fontSize={13} fontWeight="700">
                      {shortenAddress(selected.record.hash, 10, 8)}
                    </InlineText>
                    <AppIcon
                      name="content-copy"
                      size={14}
                      colorToken="textMuted"
                    />
                  </Row>
                }
              />
            ) : null}
            {selected.record.failure ? (
              <DetailRow
                label={t("records.failure")}
                value={
                  selected.record.failure === "tx.reverted"
                    ? t("tx.reverted")
                    : selected.record.failure
                }
                tone="negative"
              />
            ) : null}
          </Stack>
        ) : selected?.kind === "wallet" ? (
          <Stack>
            <DetailRow
              label={t("records.title")}
              value={`${t(`records.kind.${selected.transfer.kind}`)} · ${selected.transfer.token.symbol}`}
            />
            <DetailRow
              label={t("state.status")}
              value={
                <StatusBadge status={walletStatus(selected.transfer.status)} />
              }
            />
            <DetailRow
              label={t("transfer.amount")}
              value={formatTokenAmount(
                selected.transfer.amount,
                selected.transfer.token.displayDecimals,
                locale,
              )}
            />
            <DetailRow
              label={t("records.time")}
              value={formatDateTime(selected.transfer.updatedAt, locale, {
                withYear: true,
              })}
            />
            <DetailRow
              label={t("records.counterparty")}
              value={shortenAddress(selected.transfer.counterparty, 10, 8)}
            />
            {selected.transfer.hash ? (
              <DetailRow
                label={t("records.hash")}
                value={
                  <Row
                    alignItems="center"
                    gap="$1"
                    onPress={() => copy(selected.transfer.hash ?? "")}
                    accessibilityRole="button"
                    accessibilityLabel={t("account.copy")}
                  >
                    <InlineText fontSize={13} fontWeight="700">
                      {shortenAddress(selected.transfer.hash, 10, 8)}
                    </InlineText>
                    <AppIcon
                      name="content-copy"
                      size={14}
                      colorToken="textMuted"
                    />
                  </Row>
                }
              />
            ) : null}
            {selected.transfer.reasonKey ? (
              <DetailRow
                label={t("records.failure")}
                value={t(selected.transfer.reasonKey)}
                tone="negative"
              />
            ) : null}
          </Stack>
        ) : null}
      </Sheet>
    </Page>
  );
}
