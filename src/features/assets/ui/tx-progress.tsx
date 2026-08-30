import * as Clipboard from "expo-clipboard";
import { useFoundationRuntime } from "../../../app/runtime-context";
import type { Tx, TxStatus } from "../../../core/gateways/types";
import { shortenAddress } from "../../../core/i18n/format";
import {
  AppIcon,
  Body,
  InlineText,
  PrimaryButton,
  Row,
  SecondaryButton,
  SectionTitle,
  Stack,
  toast,
} from "../../../design-system";

const STEPS: { key: string; reached: TxStatus[] }[] = [
  { key: "tx.signed", reached: ["submitted", "confirming", "confirmed"] },
  { key: "tx.submitted", reached: ["confirming", "confirmed"] },
  { key: "tx.confirmed", reached: ["confirmed"] },
];

/**
 * 链上交易三段进度：已签名 → 已提交 → 已确认；失败态红色提示。
 * 不跳外部区块浏览器（产品约束），提供复制哈希。
 */
export function TxProgress({
  tx,
  title,
  onDone,
  onMinimize,
  doneLabel,
}: {
  tx: Tx | null | undefined;
  title: string;
  onDone: () => void;
  onMinimize?: () => void;
  doneLabel: string;
}) {
  const { t } = useFoundationRuntime();
  const status: TxStatus = tx?.status ?? "awaiting_signature";
  const failed = status === "failed";
  const done = status === "confirmed";
  return (
    <Stack gap="$4" alignItems="stretch" testID="tx-progress">
      <Stack alignItems="center" gap="$2" paddingVertical="$2">
        <Stack
          width={64}
          height={64}
          borderRadius={32}
          backgroundColor={
            failed ? "$danger" : done ? "$success" : "$surfaceVariant"
          }
          alignItems="center"
          justifyContent="center"
        >
          <AppIcon
            name={failed ? "close" : done ? "check" : "progress-clock"}
            size={32}
            colorToken={failed || done ? "onPrimary" : "primary"}
          />
        </Stack>
        <SectionTitle textAlign="center">{title}</SectionTitle>
        {tx?.hash ? (
          <Row
            alignItems="center"
            gap="$1"
            onPress={() =>
              void Clipboard.setStringAsync(tx.hash ?? "").then(() =>
                toast(t("receive.copied"), "success"),
              )
            }
            accessibilityRole="button"
            accessibilityLabel={t("account.copy")}
          >
            <Body fontSize={12}>{shortenAddress(tx.hash, 10, 8)}</Body>
            <AppIcon name="content-copy" size={14} colorToken="textMuted" />
          </Row>
        ) : null}
      </Stack>
      <Row alignItems="flex-start" justifyContent="space-between">
        {STEPS.map((step, index) => {
          const reached = step.reached.includes(status);
          const active =
            !reached &&
            (index === 0 ||
              (STEPS[index - 1]?.reached.includes(status) ?? false));
          return (
            <Stack key={step.key} flex={1} alignItems="center" gap="$1">
              <Row alignItems="center" width="100%">
                <Stack
                  flex={1}
                  height={2}
                  backgroundColor={
                    index === 0
                      ? "transparent"
                      : reached
                        ? "$success"
                        : "$borderColor"
                  }
                />
                <Stack
                  width={22}
                  height={22}
                  borderRadius={11}
                  backgroundColor={
                    reached
                      ? "$success"
                      : failed && active
                        ? "$danger"
                        : "$surfaceVariant"
                  }
                  borderWidth={reached ? 0 : 2}
                  borderColor={active ? "$primary" : "$borderColor"}
                  alignItems="center"
                  justifyContent="center"
                >
                  {reached ? (
                    <AppIcon name="check" size={14} colorToken="onPrimary" />
                  ) : null}
                </Stack>
                <Stack
                  flex={1}
                  height={2}
                  backgroundColor={
                    index === STEPS.length - 1
                      ? "transparent"
                      : STEPS[index + 1]?.reached.includes(status)
                        ? "$success"
                        : "$borderColor"
                  }
                />
              </Row>
              <InlineText
                fontSize={12}
                color={reached ? "$color" : "$textMuted"}
                fontWeight={reached || active ? "700" : "500"}
              >
                {t(step.key)}
              </InlineText>
            </Stack>
          );
        })}
      </Row>
      {failed ? (
        <Body color="$danger" textAlign="center">
          {t("tx.failed")}
          {tx?.reasonKey ? ` · ${t(tx.reasonKey)}` : ""}
        </Body>
      ) : null}
      {done || failed ? (
        <PrimaryButton onPress={onDone}>{doneLabel}</PrimaryButton>
      ) : onMinimize ? (
        <SecondaryButton onPress={onMinimize}>
          {t("tx.minimize")}
        </SecondaryButton>
      ) : null}
    </Stack>
  );
}
