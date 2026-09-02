import { usePreferencesStore } from "../../../core/preferences/preferences-store";
import { impersonatesKnownToken } from "../../../core/wallet/config/token-allowlist";
import { ChainUnavailableNotice } from "../../wallet/ui/chain-unavailable-notice";
import * as Clipboard from "expo-clipboard";
import {
  fill,
  formatTokenAmount,
  shortenAddress,
} from "../../../core/i18n/format";
import { useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import {
  CHAINS,
  NATIVE_TOKEN_ADDRESS,
  type ChainId,
} from "../../../core/gateways/types";
import { useGateways } from "../../../core/gateways/gateway-context";
import { classifyEvmAddress } from "../../../core/wallet/address";
import {
  enabledChains,
  evmChainIdOf,
  isTestnetChain,
  nativeDisplayDecimals,
} from "../../../core/wallet/config/wallet-runtime-config";
import {
  compare,
  fromDecimal,
  isZero,
  money,
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
import type {
  SendRequest,
  TokenBalance,
  WalletTransfer,
} from "../../wallet/model/wallet";
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

/**
 * A-05 转出的入口：先决定在哪条链上。
 *
 * 入口指定的链必须是租户启用的——指定了一条关掉的链是调用方的 bug，直接抛错；
 * 没指定就从第一条启用的链开始；一条启用的链都没有时如实呈现空态。
 */
export function SendScreen({
  onBack,
  initialChain,
}: {
  onBack: () => void;
  initialChain?: ChainId;
}) {
  const { t } = useFoundationRuntime();
  const [picked, setPicked] = useState<ChainId | undefined>(initialChain);
  const enabled = enabledChains();
  // 入口（深链参数）指定了一条未启用的链：如实告知，不换成别的链
  if (initialChain && !enabled.includes(initialChain))
    return (
      <SendUnavailable
        onBack={onBack}
        message={t("send.error.chainDisabled")}
      />
    );
  // 每次渲染按当前启用的链派生：配置刷新把选中的链关掉时，不能拿着它去问链层
  const chain = picked && enabled.includes(picked) ? picked : enabled[0];
  if (!chain)
    return <SendUnavailable onBack={onBack} message={t("send.noChain")} />;
  return <SendForm onBack={onBack} chain={chain} onChainChange={setPicked} />;
}

function SendUnavailable({
  onBack,
  message,
}: {
  onBack: () => void;
  message: string;
}) {
  const insets = useSafeAreaInsets();
  const { t } = useFoundationRuntime();
  return (
    <Page>
      <Content paddingTop={insets.top + 8} gap="$4">
        <ScreenHeader
          title={t("send.title")}
          onBack={onBack}
          backLabel={t("action.back")}
        />
        <Body testID="send-no-chain">{message}</Body>
      </Content>
    </Page>
  );
}

/** A-05 转出：地址（粘贴 / 地址簿）→ 网络与币种联动 → 数量 → 确认层 → 三段进度。 */
function SendForm({
  onBack,
  chain,
  onChainChange,
}: {
  onBack: () => void;
  /** 已由入口按启用的链派生，一定是启用的 */
  chain: ChainId;
  onChainChange: (chain: ChainId) => void;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { config, t } = useFoundationRuntime();
  const requireVerification = useRequireVerification();
  const largeAmountThresholdUsd = usePreferencesStore(
    (state) => state.largeAmountThresholdUsd,
  );
  const locale = config.localization.selectedLocale;
  const session = useSession();
  const address = session.data?.address ?? "";

  const [to, setTo] = useState("");
  const [tokenKey, setTokenKey] = useState<string | undefined>();
  const [text, setText] = useState("");
  /**
   * 已提交的那一笔。进度页只从这里读，不再读 selected / amount：转出成功后余额
   * 刷新会让 selected 换成另一个币（甚至变成 undefined），进度页要么标题换币种，
   * 要么整个卸载回表单——而那笔真实交易已经发出去了。
   */
  const [receipt, setReceipt] = useState<{
    record: WalletTransfer;
    to: string;
  } | null>(null);
  // 从点确认到 mutate 真正开始之间要 await 生物验证，这段窗口里 send.isPending
  // 还是 false；不挡住第二次点击就会签出两笔
  const [verifying, setVerifying] = useState(false);
  const submitting = useRef(false);
  const confirm = useRef<SheetHandle>(null);
  const book = useRef<SheetHandle>(null);

  const { wallet } = useGateways();
  // 这条链是真链还是演示账本：两者的确认页必须让用户分得清
  const onchain = wallet.sendsOnchain(chain);
  const balances = useWalletBalances(address || undefined, chain);
  const send = useSendToken();
  const tx = useWalletTransfer(receipt?.record.id, receipt?.record);
  const external = Boolean(
    session.data && session.data.connector !== "embedded",
  );
  const testnet = isTestnetChain(chain);
  const tokens = (balances.data?.items ?? []).filter(
    (item) => !isZero(item.amount),
  );
  const chainUnavailable = balances.data?.unavailable ?? [];
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
  const addressVerdict = classifyEvmAddress(to);
  // 把代币转给代币合约本身 = 永久丢失，这是最常见的一类不可逆误操作
  const addressIsTokenContract = Boolean(
    selected &&
    selected.token.address !== NATIVE_TOKEN_ADDRESS &&
    to.trim().toLowerCase() === selected.token.address.toLowerCase(),
  );
  const addressValid = addressVerdict === "valid" && !addressIsTokenContract;
  const addressError =
    to.length === 0
      ? undefined
      : addressVerdict === "invalid"
        ? t("send.addressInvalid")
        : addressVerdict === "checksum"
          ? t("send.addressChecksum")
          : addressIsTokenContract
            ? t("send.addressIsContract")
            : undefined;
  const bookHit = ADDRESS_BOOK.find(
    (entry) => entry.address.toLowerCase() === to.trim().toLowerCase(),
  );
  // 没有参考价的币 usd 是 null：大额阈值无从判断，转出一律要求验证
  const usd =
    selected && amount
      ? selected.usdValue === null
        ? null
        : (toApproxNumber(amount) /
            Math.max(toApproxNumber(selected.amount), 1e-9)) *
          selected.usdValue
      : 0;
  // 白名单只在冒名时出声：自称 USDT 却不是主流 USDT 的合约
  const impersonated = selected ? impersonatesKnownToken(selected.token) : null;
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
  // 手续费写小了，用户会以为余额够。按原生币的展示精度截断；不足最小展示单位
  // 时显示"< 0.0001 BNB"而不是"0"
  const feeText = quote.data
    ? formatTokenAmount(quote.data.fee, nativeDisplayDecimals(chain), locale)
    : quote.isFetching
      ? t("send.feeEstimating")
      : t("send.feeUnavailable");
  const exactAmount = amount
    ? `${toDecimalString(amount)} ${amount.symbol}`
    : "—";
  // "全部" 与预设的基数：原生币走真链时是扣掉手续费的上限
  const nativeOnchain =
    onchain &&
    selected !== undefined &&
    selected.token.address === NATIVE_TOKEN_ADDRESS;
  const ceilingKnown = !nativeOnchain || Boolean(quote.data?.maxAmount);
  const ceiling =
    quote.data?.maxAmount ?? selected?.amount ?? money(0n, 18, "");
  // 输入框只能显示展示精度，"全部"和预设填进去的也截到这一位——所见即所签，
  // 多出来的尘埃留在余额里。链上精度只在 fromDecimal 换算时用，这里不碰
  const precision = selected?.token.displayDecimals ?? 0;
  // 真链上没有报价就不能签：签名费要绑定到用户看到的数，没看到就没有可绑的
  const feeKnown = !onchain || Boolean(quote.data);
  const canSubmit =
    addressValid &&
    selected &&
    amount &&
    !isZero(amount) &&
    !insufficient &&
    feeKnown &&
    !send.isPending;

  const paste = async () => {
    const value = (await Clipboard.getStringAsync()).trim();
    if (value) setTo(value);
  };

  const submit = async () => {
    if (!selected || !amount) return;
    if (submitting.current) return;
    submitting.current = true;
    setVerifying(true);
    const release = () => {
      submitting.current = false;
      setVerifying(false);
    };
    // 转出：交易前验证 + 大额阈值（两者任一命中都要验证）
    const verified = await requireVerification({ usdValue: usd }).catch(
      () => false,
    );
    if (!verified) {
      release();
      return;
    }
    // 守卫一直握到 mutation 结束：isPending 的重渲染晚于 mutate 一个宏任务，
    // 这里松手的话，排队的第二次点击仍能挤进来
    send.mutate(
      {
        from: address,
        to: to.trim(),
        token: selected.token,
        amount,
        // 把确认页上显示的手续费带进去：签名时实际费用不得明显超过它
        maxFee: onchain ? quote.data?.fee : undefined,
      },
      {
        onSuccess: (record) => {
          confirm.current?.dismiss();
          setReceipt({ record, to: to.trim() });
          toast(t("send.submitted"), "success");
        },
        onError: (error) => {
          // "转出失败"把所有原因混成一件事；缺 gas 和余额不足要用户做的事完全不同
          const copy = transferErrorCopy(error);
          toast(fill(t(copy.key), copy.values ?? {}), "error");
        },
        onSettled: release,
      },
    );
  };

  if (receipt) {
    return (
      <Page>
        <Content paddingTop={insets.top + 8} flex={1} justifyContent="center">
          <TxProgress
            tx={tx.data}
            title={`${t("assets.send")} ${toDecimalString(receipt.record.amount)} ${receipt.record.amount.symbol} → ${shortenAddress(receipt.to)}`}
            onDone={onBack}
            // 真链上一笔要等几秒到几分钟，没有出口就是把用户关在这一页
            onMinimize={onBack}
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
              error={addressError}
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
              options={enabledChains().map((id) => ({
                value: id,
                // 测试链必须标出来：它的币没有价值，和主网并排会被当成真资产
                label: isTestnetChain(id)
                  ? `${CHAINS[id].name} · ${t("send.testnetTag")}`
                  : CHAINS[id].name,
              }))}
              onChange={(next) => {
                onChainChange(next);
                setTokenKey(undefined);
                setText("");
              }}
              accessibilityLabel={t("send.network")}
            />
            <ChainUnavailableNotice
              failures={chainUnavailable}
              onRetry={() => void balances.refetch()}
            />
          </Stack>

          <Stack gap="$2">
            <Body fontSize={12}>{t("transfer.token")}</Body>
            <Row
              gap="$2"
              flexWrap="wrap"
              accessibilityRole="radiogroup"
              accessibilityLabel={t("transfer.token")}
            >
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
              // 不能输入比能看到的更多位：输入框、余额、MAX 三者同一个精度
              decimals={selected.token.displayDecimals}
              helper={fill(t("send.balance"), {
                amount: formatTokenAmount(
                  selected.amount,
                  selected.token.displayDecimals,
                  locale,
                ),
              })}
              error={insufficient ? t("transfer.insufficient") : undefined}
              // 原生币的"全部"必须扣掉手续费，否则这一笔必然失败；真链上报价没回来
              // 之前不知道该扣多少，MAX 先不给（给了就是让用户签一笔必败的）
              onMax={
                ceilingKnown
                  ? () => setText(toDecimalString(ceiling, precision))
                  : undefined
              }
              maxLabel={t("common.max")}
              presets={[25, 50, 75, 100]}
              // 按整数算而不是浮点：浮点 toFixed 再去零，对 0 位精度的代币会把
              // "100" 变成 "1"
              onPreset={(pct) =>
                setText(
                  toDecimalString(
                    money(
                      (BigInt(ceiling.raw) * BigInt(pct)) / 100n,
                      ceiling.decimals,
                      ceiling.symbol,
                    ),
                    precision,
                  ),
                )
              }
              accessibilityLabel={t("send.amount")}
              testID="send-amount"
            />
          ) : null}

          <Stack>
            <DetailRow label={t("send.networkFee")} value={feeText} />
            {onchain && !quote.data && !quote.isFetching ? (
              <Body fontSize={12} color="$warning">
                {t("send.feeRequired")}
              </Body>
            ) : null}
            <DetailRow label={t("send.eta")} value={t("send.etaValue")} />
            <DetailRow label={t("send.recipientGets")} value={exactAmount} />
          </Stack>
          {usd === null || usd >= largeAmountThresholdUsd ? (
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
                  ? exactAmount
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
                  selected.token.address === NATIVE_TOKEN_ADDRESS
                    ? `${selected.token.symbol} · ${t("send.nativeToken")}`
                    : `${selected.token.symbol} · ${selected.token.address}`
                }
                tone={impersonated ? "warning" : undefined}
              />
              {/* 确认页的金额必须是签名的那个数：formatMoney 会四舍五入到两位，
                  1.009 会显示成 1.01 */}
              <DetailRow label={t("send.amount")} value={exactAmount} />
              <DetailRow label={t("send.networkFee")} value={feeText} />
              <DetailRow
                label={t("send.recipientGets")}
                value={exactAmount}
                tone="positive"
              />
            </Stack>
            {onchain ? null : (
              <Body fontSize={12} color="$textMuted" textAlign="center">
                {t("send.demoLedger")}
              </Body>
            )}
            {testnet ? (
              <Body fontSize={12} color="$warning" textAlign="center">
                {t("send.testnetNotice")}
              </Body>
            ) : null}
            {/* 外部钱包：点确认后 App 会被切到钱包 App，不说一声用户会以为闪退 */}
            {external && (send.isPending || verifying) ? (
              <Body fontSize={12} color="$textMuted" textAlign="center">
                {t("send.confirmInWallet")}
              </Body>
            ) : null}
            {impersonated ? (
              <Row
                alignItems="center"
                gap="$2"
                padding="$3"
                borderRadius="$4"
                style={{ backgroundColor: `${theme.warning.val}22` }}
                testID="send-impersonation-warning"
              >
                <AppIcon
                  name="shield-alert-outline"
                  size={18}
                  colorToken="warning"
                />
                <Body flex={1} fontSize={12} color="$warning">
                  {fill(t("send.impersonationWarning"), {
                    symbol: impersonated,
                  })}
                </Body>
              </Row>
            ) : null}
            <PrimaryButton
              disabled={send.isPending || verifying}
              onPress={() => void submit()}
              testID="send-confirm"
            >
              {send.isPending || verifying
                ? t("login.signing")
                : fill(t("send.confirm"), {
                    amount: exactAmount,
                  })}
            </PrimaryButton>
            <SecondaryButton
              disabled={send.isPending || verifying}
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
