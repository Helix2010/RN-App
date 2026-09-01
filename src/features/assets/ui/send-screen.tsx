import * as Clipboard from "expo-clipboard";
import { fill, formatMoney, shortenAddress } from "../../../core/i18n/format";
import { useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { CHAINS, type ChainId } from "../../../core/gateways/types";
import { evmChainIdOf } from "../../../core/wallet/config/wallet-runtime-config";
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
  useTheme,
} from "../../../design-system";
import { useSession } from "../../session/hooks/use-session";
import {
  useSendToken,
  useTransferQuote,
  useWalletBalances,
  useWalletTransfer,
} from "../../wallet/hooks/use-wallet";
import type { SendRequest, TokenBalance } from "../../wallet/model/wallet";
import { transferErrorCopy } from "../../wallet/model/transfer-errors";
import { TxProgress } from "./tx-progress";
import { useRequireVerification } from "../../security/use-require-verification";

/**
 * 地址簿。CRUD 是已知缺口（decisions/0009-known-gaps），所以这里是空的。
 *
 * **不能放示例地址**：转出现在会走真链，点一下「交易所 A」就是把真钱发给一个
 * 谁都不拥有的地址，而转出无法撤销。入口保留，空态如实说明。
 */
const ADDRESS_BOOK: { label: string; address: string }[] = [];
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** A-05 转出：地址（粘贴 / 地址簿）→ 网络与币种联动 → 数量 → 确认层 → 三段进度。 */
export function SendScreen({
  onBack,
  initialChain,
}: {
  onBack: () => void;
  initialChain?: ChainId;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { config, t } = useFoundationRuntime();
  const requireVerification = useRequireVerification();
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
  // 预估要用真实的收款地址：ERC-20 转给未初始化的地址 gas 更高
  const quoteRequest: SendRequest | undefined =
    address && selected && addressValid
      ? {
          from: address,
          to: to.trim(),
          token: selected.token,
          amount: selected.amount,
        }
      : undefined;
  const quote = useTransferQuote(quoteRequest);
  // Mock 账本（quote 为 null）和预估失败都显示"暂不可估"：编一个数字更糟——
  // 手续费写小了，用户会以为余额够
  const feeText = quote.data
    ? formatMoney(quote.data.fee, locale)
    : quote.isFetching
      ? t("send.feeEstimating")
      : t("send.feeUnavailable");

  const paste = async () => {
    const value = (await Clipboard.getStringAsync()).trim();
    if (value) setTo(value);
  };

  const submit = async () => {
    if (!selected || !amount) return;
    // 转出：交易前验证 + 大额阈值（两者任一命中都要验证）
    if (!(await requireVerification({ usdValue: usd }))) return;
    send.mutate(
      { from: address, to: to.trim(), token: selected.token, amount },
      {
        onSuccess: (record) => {
          confirm.current?.dismiss();
          setTxId(record.id);
          toast(t("send.submitted"), "success");
        },
        onError: (error) => {
          // "转出失败"把所有原因混成一件事；缺 gas 和余额不足要用户做的事完全不同
          const copy = transferErrorCopy(error);
          toast(fill(t(copy.key), copy.values ?? {}), "error");
        },
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
              onMax={() =>
                // 原生币的"全部"必须扣掉手续费，否则这一笔必然失败
                setText(
                  toDecimalString(quote.data?.maxAmount ?? selected.amount, 6),
                )
              }
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
        {ADDRESS_BOOK.length === 0 ? (
          <Body
            fontSize={13}
            color="$textMuted"
            textAlign="center"
            padding="$4"
          >
            {t("send.addressBookEmpty")}
          </Body>
        ) : null}
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
            {/* 完整地址而不是缩略形式：剪贴板劫持伪造的地址首尾往往一致，
                缩略显示看不出差别，而这是最后一道可见防线 */}
            <Stack
              gap="$1"
              padding="$3"
              borderRadius="$4"
              backgroundColor="$surfaceVariant"
            >
              <Body fontSize={12} color="$textMuted">
                {t("send.address")}
                {bookHit ? ` · ${bookHit.label}` : ""}
              </Body>
              <InlineText
                fontSize={13}
                fontWeight="700"
                letterSpacing={0.6}
                testID="send-confirm-address"
              >
                {to.trim()}
              </InlineText>
              <Body fontSize={11} color="$textMuted">
                {t("send.checkAddress")}
              </Body>
            </Stack>
            <Stack>
              <DetailRow
                label={t("send.network")}
                value={`${CHAINS[chain].name} · ${evmChainIdOf(chain)}`}
              />
              {/* 合约地址被篡改时，符号看起来完全一样。不显示它就等于没有防线 */}
              <DetailRow
                label={t("send.tokenContract")}
                value={
                  selected.token.address === "native"
                    ? `${selected.token.symbol} · ${t("send.nativeToken")}`
                    : `${selected.token.symbol} · ${selected.token.address}`
                }
                tone={selected.token.verified ? undefined : "warning"}
              />
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
            {selected.token.verified ? null : (
              <Row
                alignItems="center"
                gap="$2"
                padding="$3"
                borderRadius="$4"
                style={{ backgroundColor: `${theme.warning.val}22` }}
              >
                <AppIcon
                  name="shield-alert-outline"
                  size={18}
                  colorToken="warning"
                />
                <Body flex={1} fontSize={12} color="$warning">
                  {t("send.unverifiedWarning")}
                </Body>
              </Row>
            )}
            <PrimaryButton
              disabled={send.isPending}
              onPress={() => void submit()}
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
