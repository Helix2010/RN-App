import { usePredictAccountBalance } from "../hooks/use-predict-account";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { formatMoney } from "../../../core/i18n/format";
import { pickTranslation } from "../../../core/i18n/localized-text";
import {
  compare,
  fromDecimal,
  isZero,
  toDecimalString,
} from "../../../core/money/money";
import {
  AmountInput,
  Body,
  PrimaryButton,
  SegmentedControl,
  Sheet,
  type SheetHandle,
  Stack,
  toast,
} from "../../../design-system";
import { TxProgress } from "../../assets/ui/tx-progress";
import {
  usePositions,
  usePredictTx,
  useSplitMerge,
} from "../hooks/use-predict";
import { fill } from "./shared";

export type SplitMergeHandle = {
  open: (direction?: "split" | "merge", marketId?: string) => void;
};

/** 拆分 / 合并 sheet：USDC ⇄ 等量 Yes + No 份额；提交后三段进度。 */
export const SplitMergeSheet = forwardRef<
  SplitMergeHandle,
  { address: string | undefined }
>(function SplitMergeSheet({ address }, ref) {
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const sheet = useRef<SheetHandle>(null);
  const [direction, setDirection] = useState<"split" | "merge">("split");
  const [marketId, setMarketId] = useState<string>("m-btc-120k");
  const [text, setText] = useState("");
  const [txId, setTxId] = useState<string | undefined>();
  const balance = usePredictAccountBalance(address);
  const positions = usePositions(address);
  const mutation = useSplitMerge(address);
  const tx = usePredictTx(txId);

  useImperativeHandle(ref, () => ({
    open: (nextDirection = "split", nextMarket) => {
      setDirection(nextDirection);
      if (nextMarket) setMarketId(nextMarket);
      setText("");
      setTxId(undefined);
      sheet.current?.present();
    },
  }));

  // 可拆合的市场 = 当前持有的市场（合并要两边都有份额；拆分也从持仓里选）
  const markets = (positions.data ?? [])
    .filter(
      (item, index, all) =>
        !item.closed &&
        all.findIndex((other) => other.marketId === item.marketId) === index,
    )
    .map((item) => ({
      value: item.marketId,
      label: pickTranslation(item.outcomeLabel ?? item.title, locale).slice(
        0,
        14,
      ),
    }));
  const yes =
    positions.data?.find(
      (item) => item.marketId === marketId && item.outcome === "yes",
    )?.shares ?? 0;
  const no =
    positions.data?.find(
      (item) => item.marketId === marketId && item.outcome === "no",
    )?.shares ?? 0;
  const mergeable = Math.floor(Math.min(yes, no));
  // 拆分 / 合并的抵押品是 USDW，与账户余额同单位
  const amount = fromDecimal(text || "0", 6, "USDW");
  const available = balance.data?.available;
  const insufficient =
    direction === "split"
      ? Boolean(available && compare(amount, available) > 0)
      : Number(text || 0) > mergeable;
  const canSubmit = !isZero(amount) && !insufficient && !mutation.isPending;

  const submit = () => {
    mutation.mutate(
      { marketId, direction, amount },
      {
        onSuccess: (result) => {
          setTxId(result.id);
          toast(t("split.submitted"), "success");
        },
        onError: () => toast(t("state.error"), "error"),
      },
    );
  };

  return (
    <Sheet
      ref={sheet}
      title={t("split.title")}
      closeLabel={t("common.close")}
      scroll
      testID="split-sheet"
    >
      {txId ? (
        <TxProgress
          tx={tx.data}
          title={`${direction === "split" ? t("split.split") : t("split.merge")} ${formatMoney(amount, locale)}`}
          onDone={() => sheet.current?.dismiss()}
          doneLabel={t("common.done")}
        />
      ) : (
        <Stack gap="$3">
          <SegmentedControl
            value={direction}
            options={[
              { value: "split", label: t("split.split") },
              { value: "merge", label: t("split.merge") },
            ]}
            onChange={(next) => {
              setDirection(next);
              setText("");
            }}
            accessibilityLabel={t("split.title")}
          />
          <Stack gap="$1.5">
            <Body fontSize={12}>{t("split.market")}</Body>
            <SegmentedControl
              value={marketId}
              options={markets}
              onChange={setMarketId}
              accessibilityLabel={t("split.market")}
            />
          </Stack>
          <AmountInput
            value={text}
            onChangeText={setText}
            symbol={
              direction === "split" ? "USDW" : t("predict.order.shares.unit")
            }
            decimals={direction === "split" ? 2 : 0}
            helper={
              direction === "split"
                ? fill(t("split.available"), {
                    amount: available ? formatMoney(available, locale) : "—",
                  })
                : fill(t("split.holding"), { n: mergeable })
            }
            error={insufficient ? t("predict.order.insufficient") : undefined}
            onMax={() =>
              setText(
                direction === "split"
                  ? available
                    ? toDecimalString(available, 2)
                    : "0"
                  : String(mergeable),
              )
            }
            maxLabel={t("common.max")}
            accessibilityLabel={t("split.amount")}
            testID="split-amount"
          />
          <Body fontSize={12}>
            {direction === "split"
              ? t("split.hint.split")
              : t("split.hint.merge")}
          </Body>
          <PrimaryButton
            disabled={!canSubmit}
            onPress={submit}
            testID="split-submit"
          >
            {direction === "split"
              ? fill(t("split.submitSplit"), {
                  amount: isZero(amount) ? "USDW" : formatMoney(amount, locale),
                })
              : fill(t("split.submitMerge"), { n: text || 0 })}
          </PrimaryButton>
        </Stack>
      )}
    </Sheet>
  );
});
