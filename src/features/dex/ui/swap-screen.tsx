import { useEffect, useRef, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { type ChainId, type TokenRef } from "../../../core/gateways/types";
import {
  formatMoney,
  formatUsd,
  shortenAddress,
} from "../../../core/i18n/format";
import { mockNow } from "../../../core/mock/mock-runtime";
import {
  compare,
  fromDecimal,
  isZero,
  toDecimalString,
  toApproxNumber,
  type Money,
} from "../../../core/money/money";
import {
  AppIcon,
  Body,
  Content,
  DetailRow,
  IconButton,
  InlineText,
  Page,
  PageScroll,
  PrimaryButton,
  Row,
  ScreenHeader,
  SecondaryButton,
  SectionTitle,
  Sheet,
  type SheetHandle,
  SkeletonBlock,
  Stack,
  TextField,
  toast,
  useTheme,
} from "../../../design-system";
import { useSession } from "../../session/hooks/use-session";
import { requestAuth } from "../../session/model/auth-sheet-store";
import { TOKENS } from "../../wallet/fixtures/wallet";
import { useWalletBalances } from "../../wallet/hooks/use-wallet";
import {
  useApprove,
  useDexTokens,
  useQuote,
  useSwap,
  useSwapRecord,
} from "../hooks/use-dex";
import type { Quote } from "../model/dex";
import { TxProgress } from "../../assets/ui/tx-progress";
import { ChainDot, TokenAvatar, chainName, fill } from "./shared";

function fmt(value: Money, locale: string, withSymbol = true): string {
  const approx = toApproxNumber(value);
  return formatMoney(value, locale, {
    withSymbol,
    maxFraction: approx >= 1000 ? 2 : approx >= 1 ? 4 : 6,
  });
}

function defaultPair(chain: ChainId): { sell: TokenRef; buy: TokenRef } {
  const t = TOKENS as Record<string, TokenRef>;
  if (chain === "eth")
    return { sell: t.ETH as TokenRef, buy: t.UNI as TokenRef };
  if (chain === "base")
    return { sell: t["ETH.base"] as TokenRef, buy: t.AERO as TokenRef };
  return { sell: t.BNB as TokenRef, buy: t.PEPE as TokenRef };
}

/**
 * D-03 兑换 + D-04 确认层：支付 / 获得两块、报价明细全部展开、12s 自动刷新；
 * 首次卖 ERC-20 需先授权；确认层复述 + 倒计时 → 提交 → 三段进度 → 记录。
 */
export function SwapScreen({
  onBack,
  onOpenHistory,
  onOpenTransfer,
  initialChain,
  initialSell,
  initialBuy,
}: {
  onBack?: () => void;
  onOpenHistory: () => void;
  onOpenTransfer: () => void;
  initialChain?: ChainId;
  initialSell?: TokenRef;
  initialBuy?: TokenRef;
}) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const theme = useTheme();
  const session = useSession();
  const address = session.data?.address;
  const [chain, setChain] = useState<ChainId>(
    initialChain ?? initialSell?.chain ?? initialBuy?.chain ?? "bsc",
  );
  const pair = defaultPair(chain);
  const [sell, setSell] = useState<TokenRef>(
    initialSell ?? (initialBuy ? pair.sell : pair.sell),
  );
  const [buy, setBuy] = useState<TokenRef>(initialBuy ?? pair.buy);
  const [text, setText] = useState("");
  const [picker, setPicker] = useState<"sell" | "buy">("sell");
  const pickerSheet = useRef<SheetHandle>(null);
  const confirmSheet = useRef<SheetHandle>(null);
  const [swapId, setSwapId] = useState<string | undefined>();
  const [now, setNow] = useState(mockNow());

  const balances = useWalletBalances(address, chain);
  const tokens = useDexTokens({ chain, sort: "hot", limit: 30 });
  const sellBalance = balances.data?.find(
    (item) => item.token.address === sell.address,
  );
  const buyBalance = balances.data?.find(
    (item) => item.token.address === buy.address,
  );
  const amountIn = fromDecimal(text || "0", sell.decimals, sell.symbol);
  const quote = useQuote(
    !isZero(amountIn)
      ? { chain, sellToken: sell, buyToken: buy, amountIn }
      : null,
  );
  const approve = useApprove(address);
  const swap = useSwap(address);
  const record = useSwapRecord(swapId);

  useEffect(() => {
    const timer = setInterval(() => setNow(mockNow()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const secondsLeft = quote.data
    ? Math.max(
        0,
        Math.ceil((new Date(quote.data.expiresAt).getTime() - now) / 1000),
      )
    : 0;
  useEffect(() => {
    if (quote.data && secondsLeft === 0 && !swap.isPending)
      void quote.refetch();
  }, [quote, secondsLeft, swap.isPending]);

  const insufficient =
    Boolean(sellBalance && compare(amountIn, sellBalance.amount) > 0) ||
    (!sellBalance && !isZero(amountIn) && Boolean(balances.data));
  const diffPct = quote.data
    ? ((quote.data.amountOutUsd - quote.data.amountInUsd) /
        Math.max(quote.data.amountInUsd, 1e-9)) *
      100
    : 0;
  const diffTone =
    diffPct <= -10
      ? "$priceNegative"
      : diffPct <= -3
        ? "$warning"
        : "$textMuted";
  const needsApproval = Boolean(quote.data?.needsApproval);

  const switchChain = (next: ChainId) => {
    const nextPair = defaultPair(next);
    setChain(next);
    setSell(nextPair.sell);
    setBuy(nextPair.buy);
    setText("");
  };
  const flip = () => {
    setSell(buy);
    setBuy(sell);
    setText("");
  };
  const pick = (token: TokenRef) => {
    if (picker === "sell") {
      if (token.address === buy.address) setBuy(sell);
      setSell(token);
    } else {
      if (token.address === sell.address) setSell(buy);
      setBuy(token);
    }
    pickerSheet.current?.dismiss();
  };

  const onPrimary = () => {
    if (!address) {
      requestAuth({ type: "open_swap", chain, tokenAddress: buy.address });
      return;
    }
    if (insufficient) {
      onOpenTransfer();
      return;
    }
    if (!quote.data) return;
    if (needsApproval) {
      approve.mutate(
        { token: sell, spender: quote.data.spender, unlimited: true },
        {
          onSuccess: () =>
            toast(fill(t("swap.approved"), { symbol: sell.symbol }), "success"),
          onError: () => toast(t("state.error"), "error"),
        },
      );
      return;
    }
    confirmSheet.current?.present();
  };

  const submit = (current: Quote) => {
    swap.mutate(current.id, {
      onSuccess: (result) => {
        confirmSheet.current?.dismiss();
        setSwapId(result.id);
        toast(t("swap.submitted"), "success");
      },
      onError: (error) =>
        toast(
          /expired/i.test(error.message) ? t("swap.requote") : t("state.error"),
          "error",
        ),
    });
  };

  const pickerList = (tokens.data?.items ?? []).map((item) => item.token);
  const nativeToken = Object.values(TOKENS as Record<string, TokenRef>).filter(
    (token) =>
      token.chain === chain &&
      !pickerList.some((item) => item.address === token.address),
  );
  const allTokens = [...nativeToken, ...pickerList];

  if (swapId) {
    return (
      <Page>
        <Content paddingTop={insets.top + 8} paddingBottom={0}>
          <ScreenHeader
            title={t("swap.title")}
            onBack={onBack}
            backLabel={t("action.back")}
          />
        </Content>
        <Content flex={1} justifyContent="center">
          <TxProgress
            tx={
              record.data
                ? {
                    id: record.data.id,
                    status: record.data.status,
                    hash: record.data.txHash,
                    reasonKey: record.data.reasonKey,
                    updatedAt: record.data.updatedAt,
                  }
                : null
            }
            title={`${formatMoney(amountIn, locale)} → ${record.data?.amountOut ? fmt(record.data.amountOut, locale) : `${buy.symbol}`}`}
            onDone={() => {
              setSwapId(undefined);
              setText("");
              onOpenHistory();
            }}
            onMinimize={() => {
              setSwapId(undefined);
              setText("");
            }}
            doneLabel={t("swap.history")}
          />
        </Content>
      </Page>
    );
  }

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={t("swap.title")}
          onBack={onBack}
          backLabel={t("action.back")}
          action={
            <Row alignItems="center" gap="$2">
              <Row
                alignItems="center"
                gap="$1.5"
                paddingHorizontal="$2.5"
                paddingVertical="$1.5"
                borderRadius={999}
                backgroundColor="$surfaceVariant"
                onPress={() =>
                  switchChain(
                    chain === "bsc" ? "eth" : chain === "eth" ? "base" : "bsc",
                  )
                }
                accessibilityRole="button"
                accessibilityLabel={t("send.network")}
                testID="swap-chain"
              >
                <ChainDot chain={chain} />
                <InlineText fontSize={12} fontWeight="700">
                  {chainName(chain)}
                </InlineText>
                <AppIcon name="chevron-down" size={14} colorToken="textMuted" />
              </Row>
              <IconButton
                label={t("swap.history")}
                icon="history"
                size={30}
                onPress={onOpenHistory}
              />
            </Row>
          }
        />
      </Content>
      <PageScroll>
        <Content paddingTop="$1" gap="$3">
          <Stack
            padding="$3"
            borderRadius="$4"
            backgroundColor="$surfaceVariant"
            gap="$2"
            testID="swap-pay"
          >
            <Row justifyContent="space-between">
              <Body fontSize={12}>{t("swap.pay")}</Body>
              <Row alignItems="center" gap="$2">
                <Body fontSize={12}>
                  {fill(t("swap.balance"), {
                    amount: sellBalance
                      ? formatMoney(sellBalance.amount, locale, {
                          maxFraction: 4,
                        })
                      : `0 ${sell.symbol}`,
                  })}
                </Body>
                {sellBalance ? (
                  <InlineText
                    fontSize={12}
                    fontWeight="800"
                    color="$primary"
                    onPress={() =>
                      setText(toDecimalString(sellBalance.amount, 6))
                    }
                  >
                    {t("common.max")}
                  </InlineText>
                ) : null}
              </Row>
            </Row>
            <Row alignItems="center" gap="$2">
              <Stack flex={1}>
                <TextField
                  value={text}
                  onChangeText={(next) => setText(next.replace(/[^\d.]/g, ""))}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  accessibilityLabel={t("swap.pay")}
                  testID="swap-amount"
                />
              </Stack>
              <TokenChip
                token={sell}
                testID="swap-sell-token"
                onPress={() => {
                  setPicker("sell");
                  pickerSheet.current?.present();
                }}
              />
            </Row>
            <Body fontSize={12}>
              ≈{" "}
              {quote.data
                ? formatUsd(quote.data.amountInUsd, locale)
                : formatUsd(0, locale)}
            </Body>
          </Stack>
          <Row justifyContent="center" marginVertical={-18} zIndex={1}>
            <IconButton
              label={t("transfer.swapDirection")}
              icon="swap-vertical"
              size={36}
              onPress={flip}
            />
          </Row>
          <Stack
            padding="$3"
            borderRadius="$4"
            backgroundColor="$surfaceVariant"
            gap="$2"
            testID="swap-receive"
          >
            <Row justifyContent="space-between">
              <Body fontSize={12}>{t("swap.receive")}</Body>
              <Body fontSize={12}>
                {fill(t("swap.balance"), {
                  amount: buyBalance
                    ? formatMoney(buyBalance.amount, locale, { maxFraction: 4 })
                    : `0 ${buy.symbol}`,
                })}
              </Body>
            </Row>
            <Row alignItems="center" gap="$2">
              <Stack flex={1} height={48} justifyContent="center">
                {quote.isFetching && !quote.data ? (
                  <SkeletonBlock height={28} width={160} />
                ) : (
                  <InlineText
                    fontSize={28}
                    fontWeight="800"
                    fontVariant={["tabular-nums"]}
                  >
                    {quote.data
                      ? fmt(quote.data.amountOut, locale, false)
                      : "0"}
                  </InlineText>
                )}
              </Stack>
              <TokenChip
                token={buy}
                testID="swap-buy-token"
                onPress={() => {
                  setPicker("buy");
                  pickerSheet.current?.present();
                }}
              />
            </Row>
            <Row gap="$2">
              <Body fontSize={12}>
                ≈{" "}
                {quote.data
                  ? formatUsd(quote.data.amountOutUsd, locale)
                  : formatUsd(0, locale)}
              </Body>
              {quote.data ? (
                <InlineText fontSize={12} fontWeight="700" color={diffTone}>
                  ({diffPct >= 0 ? "+" : "−"}
                  {Math.abs(diffPct).toFixed(2)}%)
                </InlineText>
              ) : null}
            </Row>
          </Stack>

          {quote.data ? (
            <Stack>
              <DetailRow
                label={t("swap.rate")}
                value={`1 ${sell.symbol} = ${Number(quote.data.rate).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US", { maximumFractionDigits: 6 })} ${buy.symbol}`}
              />
              <DetailRow
                label={t("swap.priceImpact")}
                value={`${quote.data.priceImpactPct.toFixed(2)}%`}
                tone={quote.data.priceImpactPct > 3 ? "warning" : "positive"}
              />
              <DetailRow
                label={t("swap.minReceived")}
                value={fmt(quote.data.minReceived, locale)}
              />
              <DetailRow
                label={t("swap.slippage")}
                value={`${(quote.data.slippageBps / 100).toFixed(1)}% · ${quote.data.slippageAuto ? t("swap.auto") : ""}`}
              />
              <DetailRow
                label={t("swap.networkFee")}
                value={`${formatMoney(quote.data.networkFee, locale, { maxFraction: 5 })} ≈ ${formatUsd(quote.data.networkFeeUsd, locale)}`}
              />
              <DetailRow
                label={t("swap.serviceFee")}
                value={`${(quote.data.serviceFeeBps / 100).toFixed(2)}% · ${t("swap.included")}`}
              />
              <Row
                justifyContent="space-between"
                alignItems="center"
                paddingVertical="$1.5"
              >
                <Body fontSize={13}>{t("swap.route")}</Body>
                <Stack alignItems="flex-end">
                  <InlineText fontSize={13} fontWeight="700">
                    {fill(t("swap.routeBest"), {
                      router: quote.data.routerName,
                    })}
                  </InlineText>
                  <Body fontSize={11}>
                    {quote.data.route.join(" → ")} ·{" "}
                    {fill(t("swap.hops"), { n: quote.data.route.length - 1 })}
                  </Body>
                </Stack>
              </Row>
            </Stack>
          ) : null}

          <PrimaryButton
            disabled={
              Boolean(address) &&
              (!quote.data || approve.isPending) &&
              !insufficient
            }
            onPress={onPrimary}
            testID="swap-submit"
          >
            {!address
              ? t("home.connectWallet")
              : insufficient
                ? t("swap.insufficient")
                : approve.isPending
                  ? t("swap.approving")
                  : needsApproval
                    ? fill(t("swap.approve"), { symbol: sell.symbol })
                    : t("swap.submit")}
          </PrimaryButton>
          {quote.data ? (
            <Body fontSize={11} textAlign="center">
              {fill(t("swap.quoteRefresh"), { seconds: secondsLeft })}
            </Body>
          ) : null}
        </Content>
      </PageScroll>

      <Sheet
        ref={pickerSheet}
        title={t("swap.selectToken")}
        closeLabel={t("common.close")}
        scroll
      >
        {allTokens.map((token) => {
          const bal = balances.data?.find(
            (item) => item.token.address === token.address,
          );
          return (
            <Row
              key={`${token.chain}:${token.address}`}
              alignItems="center"
              gap="$3"
              paddingVertical="$2.5"
              borderBottomWidth={1}
              borderColor="$borderColor"
              onPress={() => pick(token)}
              accessibilityRole="button"
              accessibilityLabel={token.symbol}
              testID={`pick-${token.symbol}`}
            >
              <TokenAvatar token={token} size={32} />
              <Stack flex={1}>
                <SectionTitle fontSize={15}>{token.symbol}</SectionTitle>
                <Body fontSize={12}>{token.name}</Body>
              </Stack>
              <InlineText fontSize={13} fontWeight="700">
                {bal
                  ? formatMoney(bal.amount, locale, {
                      withSymbol: false,
                      maxFraction: 4,
                    })
                  : "0"}
              </InlineText>
            </Row>
          );
        })}
      </Sheet>

      <Sheet
        ref={confirmSheet}
        title={t("swap.confirmTitle")}
        closeLabel={t("common.close")}
        locked={swap.isPending}
        scroll
      >
        {quote.data ? (
          <Stack gap="$3">
            <Row
              alignItems="center"
              gap="$3"
              padding="$3"
              borderRadius="$4"
              backgroundColor="$surfaceVariant"
            >
              <TokenAvatar token={sell} size={32} />
              <Stack flex={1}>
                <Body fontSize={11}>{t("swap.pay")}</Body>
                <InlineText fontSize={18} fontWeight="800">
                  {formatMoney(amountIn, locale)}
                </InlineText>
              </Stack>
              <Body fontSize={12}>
                {formatUsd(quote.data.amountInUsd, locale)}
              </Body>
            </Row>
            <Row
              alignItems="center"
              gap="$3"
              padding="$3"
              borderRadius="$4"
              backgroundColor="$surfaceVariant"
            >
              <TokenAvatar token={buy} size={32} />
              <Stack flex={1}>
                <Body fontSize={11}>{t("swap.receive")}</Body>
                <InlineText fontSize={18} fontWeight="800">
                  {fmt(quote.data.amountOut, locale)}
                </InlineText>
              </Stack>
              <Body fontSize={12}>
                {formatUsd(quote.data.amountOutUsd, locale)}
              </Body>
            </Row>
            <Stack>
              <DetailRow
                label={t("swap.rate")}
                value={`1 ${sell.symbol} = ${Number(quote.data.rate).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${buy.symbol}`}
              />
              <DetailRow
                label={t("swap.priceImpact")}
                value={`${quote.data.priceImpactPct.toFixed(2)}%`}
              />
              <DetailRow
                label={fill(t("swap.minReceivedWithSlippage"), {
                  pct: `${(quote.data.slippageBps / 100).toFixed(1)}%`,
                })}
                value={fmt(quote.data.minReceived, locale)}
              />
              <DetailRow
                label={t("swap.networkFee")}
                value={`${formatMoney(quote.data.networkFee, locale, { maxFraction: 5 })} ≈ ${formatUsd(quote.data.networkFeeUsd, locale)}`}
              />
              <DetailRow
                label={t("swap.route")}
                value={quote.data.route.join(" → ")}
              />
              <DetailRow
                label={t("swap.recipient")}
                value={fill(t("swap.recipientWallet"), {
                  address: address ? shortenAddress(address) : "",
                })}
              />
            </Stack>
            {diffPct <= -3 ? (
              <Row alignItems="center" gap="$2">
                <AppIcon
                  name="alert-outline"
                  size={16}
                  colorToken={diffPct <= -10 ? "danger" : "warning"}
                />
                <Body
                  fontSize={12}
                  color={diffPct <= -10 ? "$danger" : "$warning"}
                >
                  {fill(t("swap.impactWarn"), {
                    pct: `${Math.abs(diffPct).toFixed(2)}%`,
                  })}
                </Body>
              </Row>
            ) : null}
            <Row
              alignItems="center"
              gap="$2"
              padding="$2.5"
              borderRadius="$3"
              style={{ backgroundColor: `${theme.info.val}22` }}
            >
              <AppIcon name="timer-outline" size={16} colorToken="info" />
              <Body fontSize={12} color="$info">
                {fill(t("swap.quoteValid"), { seconds: secondsLeft })}
              </Body>
            </Row>
            {secondsLeft <= 1 ? (
              <SecondaryButton
                onPress={() => void quote.refetch()}
                testID="swap-requote"
              >
                {t("swap.requote")}
              </SecondaryButton>
            ) : (
              <PrimaryButton
                disabled={swap.isPending}
                onPress={() => quote.data && submit(quote.data)}
                testID="swap-confirm"
              >
                {swap.isPending ? t("login.signing") : t("swap.confirm")}
              </PrimaryButton>
            )}
            <Body fontSize={11}>{t("swap.confirmNote")}</Body>
          </Stack>
        ) : null}
      </Sheet>
    </Page>
  );
}

function TokenChip({
  token,
  onPress,
  testID,
}: {
  token: TokenRef;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Row
      alignItems="center"
      gap="$1.5"
      paddingLeft="$1.5"
      paddingRight="$2.5"
      paddingVertical="$1.5"
      borderRadius={999}
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$borderColor"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={token.symbol}
      testID={testID}
      pressStyle={{ opacity: 0.8 }}
    >
      <TokenAvatar token={token} size={24} />
      <InlineText fontWeight="800">{token.symbol}</InlineText>
      <AppIcon name="chevron-down" size={16} colorToken="textMuted" />
    </Row>
  );
}
