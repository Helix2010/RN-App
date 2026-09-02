import { useMemo, useState } from "react";
import { fill, formatMoney, formatUsd } from "../../../core/i18n/format";
import { useFoundationRuntime } from "../../../app/runtime-context";
import type { TokenRef } from "../../../core/gateways/types";
import {
  compare,
  fromDecimal,
  isZero,
  toDecimalString,
  type Money,
} from "../../../core/money/money";
import {
  AmountInput,
  AppIcon,
  Body,
  DetailRow,
  IconButton,
  InlineText,
  PrimaryButton,
  Row,
  SectionTitle,
  Stack,
  toast,
} from "../../../design-system";
import {
  usePredictBalance,
  usePredictDeposit,
  usePredictTx,
  usePredictWithdraw,
} from "../../predict/hooks/use-predict";
import { TOKENS } from "../../wallet/fixtures/wallet";
import { useWalletBalances } from "../../wallet/hooks/use-wallet";
import { TxProgress } from "./tx-progress";
import { useRequireVerification } from "../../security/use-require-verification";

export type TransferDirection = "deposit" | "withdraw";
const PREDICT_USDC = { decimals: 6, symbol: "USDC" };
const WALLET_USDC = TOKENS["USDC.bsc"] as TokenRef;

/**
 * A-02 划转：钱包 ⇄ 预测账户（链上存入 / 取出）。提交后切到三段进度。
 */
export function TransferForm({
  address,
  initialDirection = "deposit",
  initialAmount,
  onFinished,
  onMinimize,
}: {
  address: string;
  initialDirection?: TransferDirection;
  initialAmount?: string;
  onFinished: () => void;
  onMinimize?: () => void;
}) {
  const { config, t } = useFoundationRuntime();
  const requireVerification = useRequireVerification();
  const locale = config.localization.selectedLocale;
  const [direction, setDirection] =
    useState<TransferDirection>(initialDirection);
  const [text, setText] = useState(initialAmount ?? "");
  const [txId, setTxId] = useState<string | undefined>();

  const wallet = useWalletBalances(address, "bsc");
  const predict = usePredictBalance(address);
  const deposit = usePredictDeposit(address);
  const withdraw = usePredictWithdraw(address);
  const tx = usePredictTx(txId);

  const walletUsdc = wallet.data?.items.find(
    (item) => item.token.symbol === "USDC" && item.token.chain === "bsc",
  );
  const available: Money =
    direction === "deposit"
      ? fromDecimal(
          walletUsdc ? toDecimalString(walletUsdc.amount) : "0",
          PREDICT_USDC.decimals,
          PREDICT_USDC.symbol,
        )
      : (predict.data?.available ?? fromDecimal("0", 6, "USDC"));
  const amount = useMemo(
    () => fromDecimal(text || "0", PREDICT_USDC.decimals, PREDICT_USDC.symbol),
    [text],
  );
  const insufficient = compare(amount, available) > 0;
  const disabled =
    isZero(amount) || insufficient || deposit.isPending || withdraw.isPending;

  const submit = async () => {
    if (!(await requireVerification())) return;
    const input = { amount, walletToken: WALLET_USDC };
    const mutation = direction === "deposit" ? deposit : withdraw;
    mutation.mutate(input, {
      onSuccess: (result) => setTxId(result.id),
      onError: () => toast(t("state.error"), "error"),
    });
  };

  if (txId) {
    const label = fill(
      direction === "deposit"
        ? t("transfer.depositTitle")
        : t("transfer.withdrawTitle"),
      { amount: formatMoney(amount, locale) },
    );
    return (
      <TxProgress
        tx={tx.data}
        title={label}
        onDone={onFinished}
        onMinimize={onMinimize}
        doneLabel={t("common.done")}
      />
    );
  }

  const fromLabel =
    direction === "deposit" ? t("assets.wallet") : t("assets.predictAccount");
  const toLabel =
    direction === "deposit" ? t("assets.predictAccount") : t("assets.wallet");
  const amountLabel = formatMoney(amount, locale);

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
            <SectionTitle fontSize={15}>
              {fromLabel}
              {direction === "deposit" ? " · BSC" : ""}
            </SectionTitle>
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
          <SectionTitle fontSize={15}>
            {toLabel}
            {direction === "withdraw" ? " · BSC" : ""}
          </SectionTitle>
        </Stack>
      </Stack>

      <Row alignItems="center" justifyContent="space-between">
        <Body>{t("transfer.token")}</Body>
        <Row alignItems="center" gap="$2">
          <Stack
            width={24}
            height={24}
            borderRadius={12}
            alignItems="center"
            justifyContent="center"
            style={{ backgroundColor: WALLET_USDC.logoColor }}
          >
            <InlineText color="white" fontSize={11} fontWeight="900">
              C
            </InlineText>
          </Stack>
          <SectionTitle fontSize={15}>USDC</SectionTitle>
        </Row>
      </Row>

      <AmountInput
        value={text}
        onChangeText={setText}
        symbol="USDC"
        decimals={2}
        helper={fill(
          direction === "deposit"
            ? t("transfer.walletAvailable")
            : t("transfer.predictAvailable"),
          { amount: formatMoney(available, locale) },
        )}
        error={insufficient ? t("transfer.insufficient") : undefined}
        onMax={() => setText(toDecimalString(available, 2))}
        maxLabel={t("common.max")}
        presets={[25, 50, 75, 100]}
        onPreset={(pct) =>
          setText(
            toDecimalString(
              fromDecimal(
                ((Number(toDecimalString(available)) * pct) / 100).toFixed(2),
                6,
                "USDC",
              ),
              2,
            ),
          )
        }
        accessibilityLabel={t("transfer.amount")}
        testID="transfer-amount"
      />

      <Stack>
        <DetailRow label={t("transfer.eta")} value={t("transfer.etaValue")} />
        <DetailRow
          label={t("transfer.networkFee")}
          value={`≈ 0.0002 BNB (${formatUsd(0.13, locale)})`}
        />
      </Stack>
      <Row alignItems="flex-start" gap="$2">
        <AppIcon name="information-outline" size={16} colorToken="textMuted" />
        <Body fontSize={12} flex={1}>
          {t("transfer.note")}
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
          { amount: isZero(amount) ? "USDC" : amountLabel },
        )}
      </PrimaryButton>
    </Stack>
  );
}
