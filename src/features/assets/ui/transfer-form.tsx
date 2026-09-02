import { useEffect, useMemo, useState } from "react";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { CHAINS } from "../../../core/gateways/types";
import {
  fill,
  formatCountdown,
  formatMoney,
  shortenAddress,
} from "../../../core/i18n/format";
import {
  compare,
  fromDecimal,
  isZero,
  money,
  scaleBps,
  toDecimalString,
  type Money,
} from "../../../core/money/money";
import { isTestnetChain } from "../../../core/wallet/config/wallet-runtime-config";
import {
  AmountInput,
  AppIcon,
  Body,
  DetailRow,
  IconButton,
  InlineText,
  Label,
  PrimaryButton,
  Row,
  SecondaryButton,
  SectionTitle,
  SkeletonBlock,
  Stack,
  toast,
} from "../../../design-system";
import {
  enablementComplete,
  type DepositAsset,
  type PendingWithdrawal,
} from "../../predict/api/account-gateway";
import {
  useClaimWithdrawal,
  useDepositQuote,
  useFaucet,
  usePendingWithdrawals,
  usePredictAccountBalance,
  usePredictAccountTx,
  usePredictDeposit,
  usePredictEnablement,
  usePredictWalletFunds,
  usePredictWithdraw,
  useUnwrapTerms,
} from "../../predict/hooks/use-predict-account";
import type { PredictTx } from "../../predict/model/predict";
import { useRequireVerification } from "../../security/use-require-verification";
import { TxProgress } from "./tx-progress";

export type TransferDirection = "deposit" | "withdraw";
const DEPOSIT_ASSETS: DepositAsset[] = ["USDC", "USDW"];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 解包等待时长，按秒 / 分 / 小时给人看。 */
function formatDelay(seconds: number, locale: string): string {
  const zh = locale === "zh-CN";
  if (seconds < 60) return zh ? `${seconds} 秒` : `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return zh ? `${minutes} 分钟` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (zh) return `${hours} 小时${rest ? ` ${rest} 分` : ""}`;
  return `${hours}h${rest ? ` ${rest}m` : ""}`;
}

/** 每秒刷新一次"现在"，只在还有未到期的记录时跑；到期与否按上一次的"现在"判断。 */
function useCountdownNow(deadlines: string[]): number {
  const [now, setNow] = useState(() => Date.now());
  const active = deadlines.some((iso) => new Date(iso).getTime() > now);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/**
 * 两阶段取回的第二步：待领取列表 + 到期倒计时 + 领取按钮。
 * 平台子图还没索引到的记录来自本机乐观记录，标出"等待索引"。
 */
export function PendingWithdrawals({
  address,
  emptyLabel,
  onClaimed,
}: {
  address: string;
  /** 不传则列表为空时什么都不渲染 */
  emptyLabel?: string;
  onClaimed?: (tx: PredictTx, item: PendingWithdrawal) => void;
}) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const requireVerification = useRequireVerification();
  const pending = usePendingWithdrawals(address);
  const claim = useClaimWithdrawal(address);
  const items = pending.data ?? [];
  const now = useCountdownNow(items.map((item) => item.claimableAt));

  const claimOne = async (item: PendingWithdrawal) => {
    if (!(await requireVerification())) return;
    claim.mutate(item.requestId, {
      onSuccess: (tx) => onClaimed?.(tx, item),
      onError: (error) =>
        toast(`${t("transfer.failed")} ${messageOf(error)}`, "error"),
    });
  };

  if (!pending.data) {
    if (pending.isError)
      return (
        <Body fontSize={12} color="$priceNegative">
          {messageOf(pending.error)}
        </Body>
      );
    return <SkeletonBlock height={56} />;
  }
  if (items.length === 0)
    return emptyLabel ? (
      <Body fontSize={12} testID="transfer-pending-empty">
        {emptyLabel}
      </Body>
    ) : null;
  return (
    <Stack gap="$2" testID="transfer-pending">
      <Label>{t("transfer.pendingTitle")}</Label>
      {items.map((item) => {
        const ready = new Date(item.claimableAt).getTime() <= now;
        return (
          <Row
            key={item.requestId}
            alignItems="center"
            gap="$3"
            padding="$3"
            borderRadius="$4"
            backgroundColor="$surfaceVariant"
            testID={`transfer-pending-${item.requestId}`}
          >
            <Stack flex={1} gap="$0.5">
              <InlineText fontWeight="800">
                {formatMoney(item.assetAmount, locale)}
              </InlineText>
              <Body fontSize={11}>
                {ready
                  ? t("transfer.claimReady")
                  : fill(t("transfer.claimableIn"), {
                      countdown: formatCountdown(item.claimableAt, now),
                    })}
                {item.source === "local"
                  ? ` · ${t("transfer.pendingIndexing")}`
                  : ""}
              </Body>
            </Stack>
            <PrimaryButton
              height={32}
              paddingHorizontal="$3"
              fontSize={12}
              disabled={!ready || claim.isPending}
              onPress={() => void claimOne(item)}
              testID={`transfer-claim-${item.requestId}`}
            >
              {t("transfer.claim")}
            </PrimaryButton>
          </Row>
        );
      })}
    </Stack>
  );
}

/**
 * A-02 划转：钱包 ⇄ 预测账户，全部是真实链上交易。
 *
 * 转入由钱包地址付 gas：USDC 走 approve + wrap 两笔，USDW 直接转一笔；先估手续费并核对
 * 原生币余额，不够就不让提交。取回分两阶段：先发起解包，到期后在列表里领取，USDC 回到
 * 钱包地址。账户没启用时不显示表单，只给启用入口。
 */
export function TransferForm({
  address,
  initialDirection = "deposit",
  initialAmount,
  onFinished,
  onMinimize,
  onOpenEnable,
}: {
  address: string;
  initialDirection?: TransferDirection;
  initialAmount?: string;
  onFinished: () => void;
  onMinimize?: () => void;
  onOpenEnable: () => void;
}) {
  const { config, t } = useFoundationRuntime();
  const requireVerification = useRequireVerification();
  const locale = config.localization.selectedLocale;
  const [direction, setDirection] =
    useState<TransferDirection>(initialDirection);
  const [asset, setAsset] = useState<DepositAsset>("USDC");
  const [text, setText] = useState(initialAmount ?? "");
  const [txId, setTxId] = useState<string | undefined>();
  const [txTitle, setTxTitle] = useState("");

  const enablement = usePredictEnablement(address);
  const enabled = enablement.data
    ? enablementComplete(enablement.data)
    : undefined;
  const funds = usePredictWalletFunds(address);
  const balance = usePredictAccountBalance(address);
  const terms = useUnwrapTerms(direction === "withdraw");
  const deposit = usePredictDeposit(address);
  const withdraw = usePredictWithdraw(address);
  const tx = usePredictAccountTx(txId);
  const chain = funds.data?.chain;
  const testnet = chain ? isTestnetChain(chain) : false;
  const faucet = useFaucet(address, testnet && enabled === true);

  const symbol = direction === "deposit" ? asset : "USDW";
  // 来源余额是唯一的精度来源（平台 public-info 的 decimals 随 Money 带过来）；
  // 它没到之前没有"金额"，也就不能提交
  const source: Money | undefined =
    direction === "deposit"
      ? asset === "USDC"
        ? funds.data?.usdc
        : funds.data?.usdw
      : balance.data?.available;
  const amount = useMemo(
    () =>
      source ? fromDecimal(text || "0", source.decimals, source.symbol) : null,
    [text, source],
  );
  const insufficient = source && amount ? compare(amount, source) > 0 : false;
  const quote = useDepositQuote(
    address,
    direction === "deposit" &&
      enabled &&
      amount &&
      !isZero(amount) &&
      !insufficient
      ? { asset, amount }
      : undefined,
  );
  const native = funds.data?.native;
  const noGas =
    direction === "deposit" &&
    native !== undefined &&
    quote.data !== undefined &&
    compare(quote.data, native) > 0;
  const belowMin =
    direction === "withdraw" &&
    terms.data !== undefined &&
    amount !== null &&
    !isZero(amount) &&
    compare(amount, terms.data.minAmount) < 0;
  const busy = deposit.isPending || withdraw.isPending;
  const disabled =
    enabled !== true ||
    amount === null ||
    isZero(amount) ||
    insufficient ||
    noGas ||
    belowMin ||
    busy ||
    (direction === "deposit" && quote.data === undefined);

  const submit = async () => {
    if (!amount) return;
    if (!(await requireVerification())) return;
    if (direction === "deposit") {
      setTxTitle(
        fill(t("transfer.depositTitle"), {
          amount: formatMoney(amount, locale),
        }),
      );
      deposit.mutate(
        { asset, amount },
        {
          onSuccess: (result) => setTxId(result.id),
          onError: (error) =>
            toast(`${t("transfer.failed")} ${messageOf(error)}`, "error"),
        },
      );
      return;
    }
    withdraw.mutate(amount, {
      onSuccess: () => {
        setText("");
        toast(t("transfer.withdrawInitiated"), "success");
      },
      onError: (error) =>
        toast(`${t("transfer.failed")} ${messageOf(error)}`, "error"),
    });
  };

  if (txId) {
    return (
      <TxProgress
        tx={tx.data}
        title={txTitle}
        onDone={onFinished}
        onMinimize={onMinimize}
        doneLabel={t("common.done")}
      />
    );
  }

  if (enabled === undefined) {
    return (
      <Stack gap="$3" testID="transfer-form">
        {enablement.isError ? (
          <>
            <Body color="$priceNegative">{messageOf(enablement.error)}</Body>
            <SecondaryButton onPress={() => void enablement.refetch()}>
              {t("action.refresh")}
            </SecondaryButton>
          </>
        ) : (
          <>
            <SkeletonBlock height={72} />
            <SkeletonBlock height={120} />
          </>
        )}
      </Stack>
    );
  }

  if (!enabled) {
    return (
      <Stack
        gap="$3"
        padding="$4"
        borderRadius="$4"
        backgroundColor="$surfaceVariant"
        testID="transfer-not-enabled"
      >
        <SectionTitle fontSize={16}>{t("assets.enablePredict")}</SectionTitle>
        <Body fontSize={12}>{t("transfer.notEnabled")}</Body>
        <PrimaryButton onPress={onOpenEnable} testID="transfer-enable">
          {t("transfer.enableNow")}
        </PrimaryButton>
      </Stack>
    );
  }

  const chainName = chain ? CHAINS[chain].name : "";
  const walletLabel = chainName
    ? `${t("assets.wallet")} · ${chainName}`
    : t("assets.wallet");
  const fromLabel =
    direction === "deposit" ? walletLabel : t("assets.predictAccount");
  const toLabel =
    direction === "deposit" ? t("assets.predictAccount") : walletLabel;
  const amountLabel =
    amount && !isZero(amount) ? formatMoney(amount, locale) : symbol;
  const faucetAmount =
    chain && faucet.status.data
      ? formatMoney(
          money(
            BigInt(faucet.status.data.amountWei),
            CHAINS[chain].nativeDecimals,
            CHAINS[chain].nativeSymbol,
          ),
          locale,
          { maxFraction: 6 },
        )
      : "";
  const error = insufficient
    ? t("transfer.insufficient")
    : noGas && native
      ? fill(t("transfer.noGas"), { symbol: native.symbol })
      : belowMin && terms.data
        ? fill(t("transfer.minWithdraw"), {
            amount: formatMoney(terms.data.minAmount, locale, {
              maxFraction: 6,
            }),
          })
        : undefined;

  return (
    <Stack gap="$3" testID="transfer-form">
      <Stack
        borderRadius="$4"
        backgroundColor="$surfaceVariant"
        padding="$3"
        gap="$2"
      >
        <Row alignItems="center" justifyContent="space-between">
          <Stack gap="$0.5">
            <Body fontSize={11}>{t("transfer.from")}</Body>
            <SectionTitle fontSize={15}>{fromLabel}</SectionTitle>
          </Stack>
          <IconButton
            label={t("transfer.swapDirection")}
            icon="swap-vertical"
            size={30}
            onPress={() => {
              setDirection((prev) =>
                prev === "deposit" ? "withdraw" : "deposit",
              );
              setText("");
            }}
          />
        </Row>
        <Stack height={1} backgroundColor="$borderColor" />
        <Stack gap="$0.5">
          <Body fontSize={11}>{t("transfer.to")}</Body>
          <SectionTitle fontSize={15}>{toLabel}</SectionTitle>
        </Stack>
      </Stack>

      <Row alignItems="center" justifyContent="space-between">
        <Body>
          {direction === "deposit" ? t("transfer.asset") : t("transfer.token")}
        </Body>
        {direction === "deposit" ? (
          <Row gap="$2">
            {DEPOSIT_ASSETS.map((item) => {
              const selected = asset === item;
              return (
                <Row
                  key={item}
                  paddingHorizontal="$3"
                  paddingVertical="$1.5"
                  borderRadius={999}
                  borderWidth={1}
                  borderColor={selected ? "$primary" : "$borderColor"}
                  backgroundColor={selected ? "$surfaceVariant" : undefined}
                  onPress={() => {
                    setAsset(item);
                    setText("");
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  testID={`transfer-asset-${item}`}
                >
                  <InlineText fontSize={12} fontWeight="700">
                    {item}
                  </InlineText>
                </Row>
              );
            })}
          </Row>
        ) : (
          <SectionTitle fontSize={15}>USDW</SectionTitle>
        )}
      </Row>

      <AmountInput
        value={text}
        onChangeText={setText}
        symbol={symbol}
        // 输入精度跟平台代币精度走：wrapper 的最小取出额是 0.001 USDW，两位小数输不出来
        decimals={source?.decimals ?? 6}
        helper={fill(
          direction === "deposit"
            ? t("transfer.walletAvailable")
            : t("transfer.predictAvailable"),
          { amount: source ? formatMoney(source, locale) : "—" },
        )}
        error={error}
        onMax={() => setText(source ? toDecimalString(source) : "")}
        maxLabel={t("common.max")}
        presets={[25, 50, 75, 100]}
        // 按比例取整走 bigint（scaleBps），不经过浮点，也不会把 1.999 进位成 2.00 超过余额
        onPreset={(pct) =>
          setText(source ? toDecimalString(scaleBps(source, pct * 100)) : "")
        }
        accessibilityLabel={t("transfer.amount")}
        testID="transfer-amount"
      />

      {direction === "deposit" ? (
        <Stack>
          <DetailRow
            label={t("transfer.networkFee")}
            value={
              quote.data
                ? `≈ ${formatMoney(quote.data, locale, { maxFraction: 6 })}`
                : quote.isFetching
                  ? "…"
                  : "—"
            }
          />
          <DetailRow
            label={t("transfer.gasBalance")}
            value={
              native ? formatMoney(native, locale, { maxFraction: 6 }) : "—"
            }
          />
        </Stack>
      ) : (
        <Stack>
          <DetailRow
            label={t("transfer.unwrapDelay")}
            value={
              terms.data ? formatDelay(terms.data.delaySeconds, locale) : "—"
            }
          />
          <DetailRow
            label={t("transfer.walletAddress")}
            value={shortenAddress(address)}
          />
        </Stack>
      )}

      {direction === "deposit" && testnet && faucet.status.data ? (
        <Row
          alignItems="center"
          gap="$3"
          padding="$3"
          borderRadius="$4"
          backgroundColor="$surfaceVariant"
          testID="transfer-faucet"
        >
          <Stack flex={1} gap="$0.5">
            <SectionTitle fontSize={13}>{t("transfer.faucet")}</SectionTitle>
            <Body fontSize={11}>
              {faucet.status.data.claimed
                ? t("transfer.faucetClaimed")
                : t("send.testnetNotice")}
            </Body>
          </Stack>
          <SecondaryButton
            height={32}
            paddingHorizontal="$3"
            fontSize={12}
            disabled={faucet.status.data.claimed || faucet.claim.isPending}
            onPress={() =>
              faucet.claim.mutate(undefined, {
                onSuccess: () => toast(t("transfer.faucetDone"), "success"),
                onError: (err) =>
                  toast(`${t("transfer.failed")} ${messageOf(err)}`, "error"),
              })
            }
            testID="transfer-faucet-claim"
          >
            {fill(t("transfer.faucetClaim"), { amount: faucetAmount })}
          </SecondaryButton>
        </Row>
      ) : null}

      <Row alignItems="flex-start" gap="$2">
        <AppIcon name="information-outline" size={16} colorToken="textMuted" />
        <Body fontSize={12} flex={1}>
          {direction === "deposit"
            ? t(`transfer.depositSteps.${asset}`)
            : fill(t("transfer.withdrawTwoPhase"), {
                delay: terms.data
                  ? formatDelay(terms.data.delaySeconds, locale)
                  : "—",
                address: shortenAddress(address),
              })}
        </Body>
      </Row>
      <PrimaryButton
        disabled={disabled}
        onPress={() => void submit()}
        testID="transfer-submit"
      >
        {fill(
          direction === "deposit"
            ? t("transfer.confirmDeposit")
            : t("transfer.confirmWithdraw"),
          { amount: amountLabel },
        )}
      </PrimaryButton>
      {deposit.step ? (
        <Body fontSize={12} testID="transfer-step">
          {t(`transfer.step.${deposit.step}`)}
        </Body>
      ) : null}
      {direction === "withdraw" ? (
        <PendingWithdrawals
          address={address}
          onClaimed={(result, item) => {
            setTxTitle(
              fill(t("transfer.claimTitle"), {
                amount: formatMoney(item.assetAmount, locale),
              }),
            );
            setTxId(result.id);
          }}
        />
      ) : null}
    </Stack>
  );
}
