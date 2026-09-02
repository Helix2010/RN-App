import { ChainUnavailableNotice } from "../../wallet/ui/chain-unavailable-notice";
import { useRef, useState } from "react";
import {
  fill,
  formatMoney,
  formatTokenAmount,
  formatUsd,
  shortenAddress,
} from "../../../core/i18n/format";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { toApproxNumber } from "../../../core/money/money";
import {
  AmountText,
  AppIcon,
  type AppIconName,
  Body,
  Card,
  Content,
  InlineText,
  Label,
  Page,
  PageScroll,
  PageState,
  PrimaryButton,
  Row,
  SectionTitle,
  type SheetHandle,
  Sheet,
  SkeletonBlock,
  Stack,
  Switch,
} from "../../../design-system";
import { useSession } from "../../session/hooks/use-session";
import { requestAuth } from "../../session/model/auth-sheet-store";
import type { TokenBalance } from "../../wallet/model/wallet";
import { useAssetsOverview } from "../hooks/use-assets";
import { ReceiveSheet } from "./receive-sheet";
import { TransferForm } from "./transfer-form";

/** A-01 资产总览：估值直接落在页面底色上；账户卡 1 + 1；币种列表标注所在账户。 */
export function AssetsScreen({
  onOpenAccount,
  onOpenSend,
  onOpenSwap,
}: {
  onOpenAccount: (kind: "predict" | "wallet") => void;
  onOpenSend: () => void;
  onOpenSwap: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const session = useSession();
  const address = session.data?.address;
  const overview = useAssetsOverview(address, config.modules.predict);
  const [hideSmall, setHideSmall] = useState(false);
  const [visible, setVisible] = useState(true);
  const receive = useRef<SheetHandle>(null);
  const transfer = useRef<SheetHandle>(null);

  if (!session.isLoading && !address) {
    return (
      <Page>
        <Content paddingTop={insets.top + 24} flex={1}>
          <PageState
            title={t("assets.signInToView")}
            description={t("login.welcomeHint")}
            action={
              <PrimaryButton
                onPress={() => requestAuth({ type: "open_tab", tab: "assets" })}
                testID="assets-connect"
              >
                {t("home.connectWallet")}
              </PrimaryButton>
            }
          />
        </Content>
      </Page>
    );
  }

  const data = overview.data;
  const holdings = (data?.holdings ?? []).filter(
    (item) => !hideSmall || item.usdValue >= 1,
  );
  const predictUsdc: TokenBalance | null = data?.predict
    ? {
        token: {
          chain: "bsc",
          address: "predict",
          symbol: "USDC",
          name: "USD Coin",
          decimals: 6,
          // 预测账户的 USDC 不来自下发目录，展示精度按稳定币惯例
          displayDecimals: 2,
          logoColor: "#2775CA",
          verified: true,
        },
        amount: data.predict.available,
        usdValue: toApproxNumber(data.predict.available),
        change24hPct: 0,
      }
    : null;

  return (
    <Page>
      <PageScroll
        refresh={{
          refreshing: overview.isRefetching,
          onRefresh: () => void overview.refetch(),
          accessibilityLabel: t("action.refresh"),
        }}
      >
        <Content paddingTop={insets.top + 16} gap="$4">
          <Row alignItems="center" justifyContent="space-between">
            <SectionTitle fontSize={20}>{t("assets.title")}</SectionTitle>
            <Stack
              onPress={() => setVisible((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={
                visible ? t("home.hideBalance") : t("home.showBalance")
              }
            >
              <AppIcon
                name={visible ? "eye-outline" : "eye-off-outline"}
                size={20}
                colorToken="textMuted"
              />
            </Stack>
          </Row>

          <Stack gap="$1">
            <Label>{t("assets.totalValue")}</Label>
            {data ? (
              <>
                <AmountText fontSize={34} lineHeight={40}>
                  {visible ? formatUsd(data.totalUsd, locale) : "••••••"}
                </AmountText>
                <Row gap="$2" alignItems="center">
                  <InlineText
                    color={
                      data.change24hUsd >= 0
                        ? "$pricePositive"
                        : "$priceNegative"
                    }
                    fontWeight="700"
                    fontSize={13}
                  >
                    {visible
                      ? `${t("assets.today")} ${formatUsd(data.change24hUsd, locale, { sign: true })} (${data.change24hPct >= 0 ? "+" : ""}${data.change24hPct.toFixed(2)}%)`
                      : "••••"}
                  </InlineText>
                </Row>
              </>
            ) : (
              <Stack gap="$2">
                <SkeletonBlock height={40} width={200} />
                <SkeletonBlock height={14} width={160} />
              </Stack>
            )}
          </Stack>

          <Row gap="$2">
            <ActionButton
              label={t("assets.receive")}
              icon="qrcode"
              primary
              onPress={() => receive.current?.present()}
              testID="assets-receive"
            />
            <ActionButton
              label={t("assets.send")}
              icon="arrow-top-right"
              onPress={onOpenSend}
              testID="assets-send"
            />
            {config.modules.predict ? (
              <ActionButton
                label={t("assets.transferAction")}
                icon="swap-vertical"
                onPress={() => transfer.current?.present()}
                testID="assets-transfer"
              />
            ) : (
              <ActionButton
                label={t("assets.swap")}
                icon="swap-horizontal"
                onPress={onOpenSwap}
                testID="assets-swap"
              />
            )}
          </Row>

          <Stack gap="$2">
            <Label>{t("assets.accounts")}</Label>
            <Card
              padding="$3"
              shadowOpacity={0}
              onPress={() => onOpenAccount("wallet")}
              accessibilityRole="button"
              testID="assets-wallet"
            >
              <Row alignItems="center" gap="$3">
                <Stack
                  width={40}
                  height={40}
                  borderRadius={12}
                  backgroundColor="$surfaceVariant"
                  alignItems="center"
                  justifyContent="center"
                >
                  <AppIcon
                    name="wallet-outline"
                    size={22}
                    colorToken="primary"
                  />
                </Stack>
                <Stack flex={1}>
                  <SectionTitle fontSize={15}>
                    {t("assets.wallet")}
                  </SectionTitle>
                  <Body fontSize={12}>
                    {address ? shortenAddress(address) : ""} ·{" "}
                    {fill(t("assets.chains"), {
                      n: String(data?.wallet.chains ?? 0),
                    })}
                  </Body>
                </Stack>
                <Stack alignItems="flex-end">
                  <InlineText fontWeight="800">
                    {data
                      ? visible
                        ? formatUsd(data.wallet.usd, locale)
                        : "••••"
                      : "—"}
                  </InlineText>
                </Stack>
                <AppIcon
                  name="chevron-right"
                  size={20}
                  colorToken="textMuted"
                />
              </Row>
            </Card>
            {config.modules.predict ? (
              <Card
                padding="$3"
                shadowOpacity={0}
                onPress={() => onOpenAccount("predict")}
                accessibilityRole="button"
                testID="assets-predict"
              >
                <Row alignItems="center" gap="$3">
                  <Stack
                    width={40}
                    height={40}
                    borderRadius={12}
                    backgroundColor="$surfaceVariant"
                    alignItems="center"
                    justifyContent="center"
                  >
                    <AppIcon
                      name="chart-timeline-variant"
                      size={22}
                      colorToken="primary"
                    />
                  </Stack>
                  <Stack flex={1}>
                    <SectionTitle fontSize={15}>
                      {t("assets.predictAccount")}
                    </SectionTitle>
                    <Body fontSize={12}>
                      {data?.predict
                        ? `${t("assets.available")} ${formatMoney(data.predict.available, locale)} · ${t("assets.positions")} ${formatUsd(data.predict.positionsValueUsd, locale)}`
                        : "—"}
                    </Body>
                  </Stack>
                  <InlineText fontWeight="800">
                    {data?.predict
                      ? visible
                        ? formatUsd(data.predict.usd, locale)
                        : "••••"
                      : "—"}
                  </InlineText>
                  <AppIcon
                    name="chevron-right"
                    size={20}
                    colorToken="textMuted"
                  />
                </Row>
              </Card>
            ) : null}
          </Stack>

          <Stack gap="$2">
            <Row alignItems="center" justifyContent="space-between">
              <Label>{t("assets.coins")}</Label>
              <Row alignItems="center" gap="$2">
                <Body fontSize={12}>{t("assets.hideSmall")}</Body>
                <Switch
                  value={hideSmall}
                  onValueChange={setHideSmall}
                  accessibilityLabel={t("assets.hideSmall")}
                  testID="assets-hide-small"
                />
              </Row>
            </Row>
            {data ? (
              <>
                <ChainUnavailableNotice
                  failures={data.unavailable}
                  onRetry={() => void overview.refetch()}
                />
                {predictUsdc ? (
                  <HoldingRow
                    item={predictUsdc}
                    account={t("assets.predictAccount")}
                    note={
                      data.predict
                        ? `${t("assets.lockedInOrders")} ${formatMoney(data.predict.lockedInOrders, locale, { withSymbol: false })}`
                        : undefined
                    }
                    locale={locale}
                    visible={visible}
                  />
                ) : null}
                {holdings.map((item) => (
                  <HoldingRow
                    key={`${item.token.chain}:${item.token.address}`}
                    item={item}
                    account={t("assets.wallet")}
                    note={item.token.chain.toUpperCase()}
                    locale={locale}
                    visible={visible}
                  />
                ))}
                {holdings.length === 0 && !predictUsdc ? (
                  <Body>{t("state.empty")}</Body>
                ) : null}
              </>
            ) : (
              <Stack gap="$2">
                <SkeletonBlock height={56} />
                <SkeletonBlock height={56} />
                <SkeletonBlock height={56} />
              </Stack>
            )}
          </Stack>
        </Content>
      </PageScroll>
      {session.data ? (
        <ReceiveSheet
          ref={receive}
          address={session.data.address}
          ens={session.data.ens}
          chains={session.data.chains}
        />
      ) : null}
      {address && config.modules.predict ? (
        <Sheet
          ref={transfer}
          title={t("transfer.title")}
          closeLabel={t("common.close")}
          scroll
          testID="transfer-sheet"
        >
          <TransferForm
            address={address}
            onFinished={() => transfer.current?.dismiss()}
            onMinimize={() => transfer.current?.dismiss()}
          />
        </Sheet>
      ) : null}
    </Page>
  );
}

function ActionButton({
  label,
  icon,
  primary,
  onPress,
  testID,
}: {
  label: string;
  icon: AppIconName;
  primary?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Stack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$1"
      height={56}
      borderRadius="$4"
      backgroundColor={primary ? "$primary" : "$surfaceVariant"}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      pressStyle={{ opacity: 0.8 }}
    >
      <AppIcon
        name={icon}
        size={20}
        colorToken={primary ? "onPrimary" : "color"}
      />
      <InlineText
        fontSize={12}
        fontWeight="700"
        color={primary ? "$onPrimary" : "$color"}
      >
        {label}
      </InlineText>
    </Stack>
  );
}

export function HoldingRow({
  item,
  account,
  note,
  locale,
  visible = true,
  onPress,
}: {
  item: TokenBalance;
  account?: string;
  note?: string;
  locale: string;
  visible?: boolean;
  onPress?: () => void;
}) {
  return (
    <Row
      alignItems="center"
      gap="$3"
      paddingVertical="$2.5"
      borderBottomWidth={1}
      borderColor="$borderColor"
      onPress={onPress}
      accessibilityRole={onPress ? "button" : undefined}
    >
      <Stack
        width={36}
        height={36}
        borderRadius={18}
        alignItems="center"
        justifyContent="center"
        style={{ backgroundColor: item.token.logoColor }}
      >
        <InlineText color="white" fontWeight="900">
          {item.token.symbol[0]}
        </InlineText>
      </Stack>
      <Stack flex={1}>
        <SectionTitle fontSize={15}>{item.token.symbol}</SectionTitle>
        <Body fontSize={12}>{[account, note].filter(Boolean).join(" · ")}</Body>
      </Stack>
      <Stack alignItems="flex-end">
        <InlineText fontWeight="700">
          {/* 按展示精度向下截断：四舍五入会把 0.999 显示成 1.00，而 1 个转不出 */}
          {visible
            ? formatTokenAmount(
                item.amount,
                item.token.displayDecimals,
                locale,
                {
                  withSymbol: false,
                },
              )
            : "••••"}
        </InlineText>
        <Body fontSize={12}>
          ≈ {visible ? formatUsd(item.usdValue, locale) : "••••"}
        </Body>
      </Stack>
    </Row>
  );
}
