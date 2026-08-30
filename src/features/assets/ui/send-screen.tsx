import * as Clipboard from "expo-clipboard";
import { useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { CHAINS, type ChainId } from "../../../core/gateways/types";
import {
  formatMoney,
  formatUsd,
  shortenAddress,
} from "../../../core/i18n/format";
import {
  compare,
  fromDecimal,
  isZero,
  toApproxNumber,
  toDecimalString,
} from "../../../core/money/money";
import {
  AmountInput,
  AppIcon,
  Badge,
  Body,
  Content,
  DetailRow,
  InlineText,
  Page,
  PageScroll,
  PrimaryButton,
  Row,
  ScreenHeader,
  SecondaryButton,
  SectionTitle,
  SegmentedControl,
  Sheet,
  type SheetHandle,
  Stack,
  TextField,
  toast,
} from "../../../design-system";
import { useSession } from "../../session/hooks/use-session";
import {
  useSendToken,
  useWalletBalances,
  useWalletTransfer,
} from "../../wallet/hooks/use-wallet";
import type { TokenBalance } from "../../wallet/model/wallet";
import { TxProgress } from "./tx-progress";

const ADDRESS_BOOK = [
  { label: "交易所 A", address: "0x9b2e4d17c6a83f05e1b7d9c2a4f6e8b0d3c5a7e9" },
  { label: "冷钱包", address: "0x1c3e5a7b9d2f4a6c8e0b1d3f5a7c9e2b4d6f8a0c" },
];
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function fill(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, value),
    template,
  );
}

/** A-05 转出：地址（粘贴 / 地址簿）→ 网络与币种联动 → 数量 → 确认层 → 三段进度。 */
export function SendScreen({
  onBack,
  initialChain,
}: {
  onBack: () => void;
  initialChain?: ChainId;
}) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const session = useSession();
  const address = session.data?.address ?? "";
  const [chain, setChain] = useState<ChainId>(initialChain ?? "bsc");
  const [to, setTo] = useState("");
  const [tokenKey, setTokenKey] = useState<string | undefined>();
  const [text, setText] = useState("");
  const [txId, setTxId] = useState<string | undefined>();
  const confirm = useRef<SheetHandle>(null);
  const book = useRef<SheetHandle>(null);

  const balances = useWalletBalances(address || undefined, chain);
  const send = useSendToken();
  const tx = useWalletTransfer(txId);
  const tokens = (balances.data ?? []).filter((item) => !isZero(item.amount));
  const selected: TokenBalance | undefined =
    tokens.find(
      (item) => `${item.token.chain}:${item.token.address}` === tokenKey,
    ) ?? tokens[0];
  const amount = selected
    ? fromDecimal(text || "0", selected.token.decimals, selected.token.symbol)
    : undefined;
  const insufficient = Boolean(
    selected && amount && compare(amount, selected.amount) > 0,
  );
  const addressValid = EVM_ADDRESS.test(to.trim());
  const bookHit = ADDRESS_BOOK.find(
    (entry) => entry.address.toLowerCase() === to.trim().toLowerCase(),
  );
  const usd =
    selected && amount
      ? (toApproxNumber(amount) /
          Math.max(toApproxNumber(selected.amount), 1e-9)) *
        selected.usdValue
      : 0;
  const canSubmit =
    addressValid &&
    selected &&
    amount &&
    !isZero(amount) &&
    !insufficient &&
    !send.isPending;
  const nativeSymbol = CHAINS[chain].nativeSymbol;
  const feeText =
    chain === "bsc"
      ? `≈ 0.0003 ${nativeSymbol} (${formatUsd(0.19, locale)})`
      : `≈ 0.0009 ${nativeSymbol} (${formatUsd(4.1, locale)})`;

  const paste = async () => {
    const value = (await Clipboard.getStringAsync()).trim();
    if (value) setTo(value);
  };

  const submit = () => {
    if (!selected || !amount) return;
    send.mutate(
      { from: address, to: to.trim(), token: selected.token, amount },
      {
        onSuccess: (record) => {
          confirm.current?.dismiss();
          setTxId(record.id);
          toast(t("send.submitted"), "success");
        },
        onError: () => toast(t("send.failed"), "error"),
      },
    );
  };

  if (txId && selected && amount) {
    return (
      <Page>
        <Content paddingTop={insets.top + 8} flex={1} justifyContent="center">
          <TxProgress
            tx={tx.data}
            title={`${t("assets.send")} ${formatMoney(amount, locale)} → ${bookHit?.label ?? shortenAddress(to.trim())}`}
            onDone={onBack}
            doneLabel={t("common.done")}
          />
        </Content>
      </Page>
    );
  }

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={t("send.title")}
          onBack={onBack}
          backLabel={t("action.back")}
        />
      </Content>
      <PageScroll>
        <Content paddingTop="$2" gap="$4">
          <Stack gap="$2">
            <Body fontSize={12}>{t("send.address")}</Body>
            <TextField
              value={to}
              onChangeText={setTo}
              placeholder={t("send.addressPlaceholder")}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel={t("send.address")}
              testID="send-address"
              error={
                to.length > 0 && !addressValid
                  ? t("send.addressInvalid")
                  : undefined
              }
              trailing={
                <Row gap="$2">
                  <Stack
                    onPress={() => void paste()}
                    accessibilityRole="button"
                    accessibilityLabel={t("send.paste")}
                  >
                    <AppIcon
                      name="content-paste"
                      size={20}
                      colorToken="primary"
                    />
                  </Stack>
                  <Stack
                    onPress={() => book.current?.present()}
                    accessibilityRole="button"
                    accessibilityLabel={t("send.addressBook")}
                    testID="send-address-book"
                  >
                    <AppIcon
                      name="book-account-outline"
                      size={20}
                      colorToken="primary"
                    />
                  </Stack>
                </Row>
              }
            />
            {addressValid ? (
              <Row alignItems="center" gap="$2">
                {bookHit ? (
                  <Badge borderWidth={0} backgroundColor="$surfaceVariant">
                    <InlineText fontSize={11} fontWeight="700" color="$primary">
                      {bookHit.label}
                    </InlineText>
                  </Badge>
                ) : null}
                <Row alignItems="center" gap="$1">
                  <AppIcon name="check-circle" size={14} colorToken="success" />
                  <InlineText fontSize={12} color="$success">
                    {fill(t("send.addressValid"), {
                      chain: CHAINS[chain].name,
                    })}
                  </InlineText>
                </Row>
              </Row>
            ) : null}
          </Stack>

          <Stack gap="$2">
            <Body fontSize={12}>{t("send.network")}</Body>
            <SegmentedControl
              value={chain}
              options={(Object.keys(CHAINS) as ChainId[]).map((id) => ({
                value: id,
                label: CHAINS[id].name,
              }))}
              onChange={(next) => {
                setChain(next);
                setTokenKey(undefined);
                setText("");
              }}
              accessibilityLabel={t("send.network")}
            />
          </Stack>

          <Stack gap="$2">
            <Body fontSize={12}>{t("transfer.token")}</Body>
            <Row gap="$2" flexWrap="wrap">
              {tokens.map((item) => {
                const key = `${item.token.chain}:${item.token.address}`;
                const active =
                  selected &&
                  key === `${selected.token.chain}:${selected.token.address}`;
                return (
                  <Row
                    key={key}
                    alignItems="center"
                    gap="$2"
                    paddingHorizontal="$3"
                    paddingVertical="$2"
                    borderRadius={999}
                    backgroundColor={active ? "$primary" : "$surfaceVariant"}
                    onPress={() => {
                      setTokenKey(key);
                      setText("");
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: Boolean(active) }}
                  >
                    <Stack
                      width={18}
                      height={18}
                      borderRadius={9}
                      style={{ backgroundColor: item.token.logoColor }}
                    />
                    <InlineText
                      fontWeight="700"
                      color={active ? "$onPrimary" : "$color"}
                    >
                      {item.token.symbol}
                    </InlineText>
                  </Row>
                );
              })}
            </Row>
          </Stack>

          {selected ? (
            <AmountInput
              value={text}
              onChangeText={setText}
              symbol={selected.token.symbol}
              decimals={Math.min(6, selected.token.decimals)}
              helper={fill(t("send.balance"), {
                amount: formatMoney(selected.amount, locale),
              })}
              error={insufficient ? t("transfer.insufficient") : undefined}
              onMax={() => setText(toDecimalString(selected.amount, 6))}
              maxLabel={t("common.max")}
              presets={[25, 50, 75, 100]}
              onPreset={(pct) =>
                setText(
                  ((toApproxNumber(selected.amount) * pct) / 100)
                    .toFixed(Math.min(6, selected.token.decimals))
                    .replace(/\.?0+$/, ""),
                )
              }
              accessibilityLabel={t("send.amount")}
              testID="send-amount"
            />
          ) : null}

          <Stack>
            <DetailRow label={t("send.networkFee")} value={feeText} />
            <DetailRow label={t("send.eta")} value={t("send.etaValue")} />
            <DetailRow
              label={t("send.recipientGets")}
              value={amount && selected ? formatMoney(amount, locale) : "—"}
            />
          </Stack>
          {usd > 1000 ? (
            <Row alignItems="center" gap="$2">
              <AppIcon name="fingerprint" size={16} colorToken="warning" />
              <Body fontSize={12}>{t("send.biometricHint")}</Body>
            </Row>
          ) : null}
          <PrimaryButton
            disabled={!canSubmit}
            onPress={() => confirm.current?.present()}
            testID="send-submit"
          >
            {fill(t("send.confirm"), {
              amount:
                amount && selected && !isZero(amount)
                  ? formatMoney(amount, locale)
                  : (selected?.token.symbol ?? ""),
            })}
          </PrimaryButton>
        </Content>
      </PageScroll>

      <Sheet
        ref={book}
        title={t("send.addressBook")}
        closeLabel={t("common.close")}
      >
        {ADDRESS_BOOK.map((entry) => (
          <Row
            key={entry.address}
            alignItems="center"
            gap="$3"
            padding="$3"
            borderRadius="$4"
            backgroundColor="$surfaceVariant"
            onPress={() => {
              setTo(entry.address);
              book.current?.dismiss();
            }}
            accessibilityRole="button"
            accessibilityLabel={entry.label}
          >
            <Stack flex={1}>
              <SectionTitle fontSize={15}>{entry.label}</SectionTitle>
              <Body fontSize={12}>{shortenAddress(entry.address, 10, 6)}</Body>
            </Stack>
            <AppIcon name="chevron-right" size={20} colorToken="textMuted" />
          </Row>
        ))}
      </Sheet>

      <Sheet
        ref={confirm}
        title={t("send.confirmTitle")}
        closeLabel={t("common.close")}
        locked={send.isPending}
      >
        {selected && amount ? (
          <Stack gap="$3">
            <Stack>
              <DetailRow
                label={t("send.address")}
                value={`${bookHit ? `${bookHit.label} · ` : ""}${shortenAddress(to.trim(), 10, 6)}`}
              />
              <DetailRow label={t("send.network")} value={CHAINS[chain].name} />
              <DetailRow
                label={t("send.amount")}
                value={formatMoney(amount, locale)}
              />
              <DetailRow label={t("send.networkFee")} value={feeText} />
              <DetailRow
                label={t("send.recipientGets")}
                value={formatMoney(amount, locale)}
                tone="positive"
              />
            </Stack>
            <PrimaryButton
              disabled={send.isPending}
              onPress={submit}
              testID="send-confirm"
            >
              {send.isPending
                ? t("login.signing")
                : fill(t("send.confirm"), {
                    amount: formatMoney(amount, locale),
                  })}
            </PrimaryButton>
            <SecondaryButton
              disabled={send.isPending}
              onPress={() => confirm.current?.dismiss()}
            >
              {t("common.cancel")}
            </SecondaryButton>
          </Stack>
        ) : null}
      </Sheet>
    </Page>
  );
}
