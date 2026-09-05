import {
  enabledChains,
  isTestnetChain,
} from "../../../core/wallet/config/wallet-runtime-config";
import { CHAINS, type ChainId } from "../../../core/gateways/types";
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
  ActionTile,
  AmountText,
  AppIcon,
  Body,
  Card,
  ChipRow,
  Content,
  InlineText,
  Label,
  Page,
  PageScroll,
  PageState,
  PrimaryButton,
  Row,
  SectionTitle,
  Sheet,
  SkeletonBlock,
  Spinner,
  Stack,
  Switch,
  type ChipOption,
  type SheetHandle,
} from "../../../design-system";
import { useSession } from "../../session/hooks/use-session";
import { requestAuth } from "../../session/model/auth-sheet-store";
import { useAssetsOverview, type AssetRow } from "../hooks/use-assets";
import { ReceiveSheet } from "./receive-sheet";
import { TransferForm } from "./transfer-form";

/** 链筛选 chip：全部 + 每条启用的链（短名 + 品牌色点，测试网带小标）。 */
export function useChainChips(
  chains: ChainId[],
): ChipOption<ChainId | "all">[] {
  const { t } = useFoundationRuntime();
  return [
    { value: "all" as const, label: t("assets.allChains") },
    ...chains.map((id) => ({
      value: id,
      label: CHAINS[id].shortName,
      color: CHAINS[id].color,
      tag: isTestnetChain(id) ? t("send.testnetTag") : undefined,
    })),
  ];
}

/**
 * A-01 资产总览：估值直接落在页面底色上；账户卡 1 + 1；币种列表标注所在账户。
 * 每条链的余额独立到达：先按下发目录列出币种，哪条链的余额先到就先填哪条。
 */
export function AssetsScreen({
  onOpenAccount,
  onOpenSend,
  onOpenSwap,
  onOpenPredictEnable,
  onOpenRecords,
}: {
  onOpenAccount: (kind: "predict" | "wallet") => void;
  onOpenSend: () => void;
  onOpenSwap: () => void;
  onOpenPredictEnable: () => void;
  onOpenRecords: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const session = useSession();
  const address = session.data?.address;
  const overview = useAssetsOverview(address, config.modules.predict);
  const [hideSmall, setHideSmall] = useState(false);
  const [visible, setVisible] = useState(true);
  const [pickedChain, setPickedChain] = useState<ChainId | "all">("all");
  const receive = useRef<SheetHandle>(null);
  const transfer = useRef<SheetHandle>(null);
  const chains = enabledChains();
  const chips = useChainChips(chains);

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
  // 链筛选只列租户启用的链；选中的链被关掉后回到"全部"
  const chainFilter =
    pickedChain === "all" || chains.includes(pickedChain) ? pickedChain : "all";
  const rows = (data?.rows ?? []).filter(
    (row) =>
      (chainFilter === "all" || row.token.chain === chainFilter) &&
      // 没有估值 / 还没到的币不算"小额"：不知道值多少，不能替用户藏起来
      (!hideSmall || row.usdValue === null || row.usdValue >= 1),
  );
  const predict = data?.predict?.status === "enabled" ? data.predict : null;
  const predictUsdw: AssetRow | null =
    predict && (chainFilter === "all" || predict.chain === chainFilter)
      ? {
          token: {
            chain: predict.chain,
            address: "predict",
            symbol: "USDW",
            name: "Wrapped USD",
            decimals: 6,
            // 预测账户的 USDW 不来自下发目录，展示精度按稳定币惯例
            displayDecimals: 2,
            logoColor: "#2775CA",
            verified: true,
          },
          amount: predict.safeBalance,
          // USDW 由 wrapper 合约按 1:1 兑 USDC 铸销，估值按 1 美元
          usdValue: toApproxNumber(predict.safeBalance),
          change24hPct: 0,
          loading: false,
        }
      : null;
  const hidden = (text: string) => (visible ? text : "••••");

  return (
    <Page>
      <PageScroll
        refresh={{
          refreshing: overview.isRefetching,
          onRefresh: () => overview.refetch(),
          accessibilityLabel: t("action.refresh"),
        }}
      >
        <Content paddingTop={insets.top + 16} gap="$4">
          <Row alignItems="center" justifyContent="space-between">
            <SectionTitle fontSize={20}>{t("assets.title")}</SectionTitle>
            <Row gap="$3" alignItems="center">
              <Stack
                onPress={() => setVisible((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={
                  visible ? t("home.hideBalance") : t("home.showBalance")
                }
                hitSlop={8}
              >
                <AppIcon
                  name={visible ? "eye-outline" : "eye-off-outline"}
                  size={20}
                  colorToken="textMuted"
                />
              </Stack>
              <Stack
                onPress={onOpenRecords}
                accessibilityRole="button"
                accessibilityLabel={t("records.title")}
                hitSlop={8}
                testID="assets-records"
              >
                <AppIcon name="history" size={20} colorToken="textMuted" />
              </Stack>
            </Row>
          </Row>

          <Stack gap="$1">
            <Label>{t("assets.totalValue")}</Label>
            {data ? (
              <>
                <Row alignItems="center" gap="$2">
                  <AmountText fontSize={34} lineHeight={40}>
                    {visible ? formatUsd(data.totalUsd, locale) : "••••••"}
                  </AmountText>
                  {data.loading ? (
                    <Spinner size="small" color="$textMuted" />
                  ) : null}
                </Row>
                {data.partial && !data.loading ? (
                  <Body fontSize={12} color="$warning" testID="assets-partial">
                    {t("assets.totalPartial")}
                  </Body>
                ) : null}
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
            <ActionTile
              label={t("assets.receive")}
              icon="qrcode"
              primary
              onPress={() => receive.current?.present()}
              testID="assets-receive"
            />
            <ActionTile
              label={t("assets.send")}
              icon="arrow-top-right"
              onPress={onOpenSend}
              testID="assets-send"
            />
            {config.modules.predict ? (
              <ActionTile
                label={t("assets.transferAction")}
                icon="swap-vertical"
                onPress={() => transfer.current?.present()}
                testID="assets-transfer"
              />
            ) : (
              <ActionTile
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
                <AccountIcon icon="wallet-outline" />
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
                    {data ? hidden(formatUsd(data.wallet.usd, locale)) : "—"}
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
                  <AccountIcon icon="chart-timeline-variant" />
                  <Stack flex={1}>
                    <SectionTitle fontSize={15}>
                      {t("assets.predictAccount")}
                    </SectionTitle>
                    <Body fontSize={12}>
                      {predict
                        ? `${t("assets.available")} ${formatMoney(predict.available, locale)} · ${t("assets.lockedInOrders")} ${formatMoney(predict.lockedInOrders, locale, { withSymbol: false })}`
                        : data?.predict?.status === "not-enabled"
                          ? t("assets.predictNotEnabled")
                          : "—"}
                    </Body>
                  </Stack>
                  <InlineText fontWeight="800">
                    {predict ? hidden(formatUsd(predict.usd, locale)) : "—"}
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
            {chains.length > 1 ? (
              <ChipRow
                value={chainFilter}
                options={chips}
                onChange={setPickedChain}
                accessibilityLabel={t("assets.allChains")}
                testID="chain-chip"
              />
            ) : null}
            {data ? (
              <>
                <ChainUnavailableNotice
                  failures={data.unavailable}
                  onRetry={() => overview.refetch()}
                />
                {predictUsdw ? (
                  <HoldingRow
                    item={predictUsdw}
                    account={t("assets.predictAccount")}
                    note={
                      predict
                        ? `${t("assets.lockedInOrders")} ${formatMoney(predict.lockedInOrders, locale, { withSymbol: false })}`
                        : undefined
                    }
                    locale={locale}
                    visible={visible}
                  />
                ) : null}
                {rows.map((item) => (
                  <HoldingRow
                    key={`${item.token.chain}:${item.token.address}`}
                    item={item}
                    account={t("assets.wallet")}
                    note={CHAINS[item.token.chain].name}
                    locale={locale}
                    visible={visible}
                  />
                ))}
                {rows.length === 0 &&
                !predictUsdw &&
                data.unavailable.length === 0 ? (
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
            onOpenEnable={() => {
              transfer.current?.dismiss();
              onOpenPredictEnable();
            }}
            onFinished={() => transfer.current?.dismiss()}
            onMinimize={() => transfer.current?.dismiss()}
            onOpenRecords={() => {
              transfer.current?.dismiss();
              onOpenRecords();
            }}
          />
        </Sheet>
      ) : null}
    </Page>
  );
}

function AccountIcon({
  icon,
}: {
  icon: "wallet-outline" | "chart-timeline-variant";
}) {
  return (
    <Stack
      width={40}
      height={40}
      borderRadius={12}
      backgroundColor="$surfaceVariant"
      alignItems="center"
      justifyContent="center"
    >
      <AppIcon name={icon} size={22} colorToken="primary" />
    </Stack>
  );
}

/** 币种行：余额还没到（`loading`）时金额与估值留骨架，币名与链徽标先出来。 */
export function HoldingRow({
  item,
  account,
  note,
  locale,
  visible = true,
  onPress,
}: {
  item: AssetRow;
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
      testID={`holding-${item.token.chain}-${item.token.symbol}`}
    >
      <TokenAvatar token={item.token} size={36} />
      <Stack flex={1}>
        <SectionTitle fontSize={15}>{item.token.symbol}</SectionTitle>
        <Body fontSize={12}>{[account, note].filter(Boolean).join(" · ")}</Body>
      </Stack>
      {item.loading || item.amount === null ? (
        <Stack alignItems="flex-end" gap="$1" testID="holding-loading">
          <SkeletonBlock height={16} width={72} />
          <SkeletonBlock height={12} width={48} />
        </Stack>
      ) : (
        <Stack alignItems="flex-end">
          <InlineText fontWeight="700">
            {/* 按展示精度向下截断：四舍五入会把 0.999 显示成 1.00，而 1 个转不出 */}
            {visible
              ? formatTokenAmount(
                  item.amount,
                  item.token.displayDecimals,
                  locale,
                  { withSymbol: false },
                )
              : "••••"}
          </InlineText>
          <Body fontSize={12}>
            {item.usdValue === null
              ? "—"
              : `≈ ${visible ? formatUsd(item.usdValue, locale) : "••••"}`}
          </Body>
        </Stack>
      )}
    </Row>
  );
}

/**
 * 币种头像：底色是目录里的 logoColor，右下角叠一个链徽标（链的品牌色 + 首字母），
 * 让用户一眼知道这个币在哪条链上——同一个 USDC 在 eth 和 op-sepolia 上是两个资产。
 */
export function TokenAvatar({
  token,
  size,
}: {
  token: { symbol: string; logoColor: string; chain: ChainId };
  size: number;
}) {
  const badge = Math.round(size * 0.42);
  return (
    <Stack width={size} height={size}>
      <Stack
        width={size}
        height={size}
        borderRadius={size / 2}
        alignItems="center"
        justifyContent="center"
        style={{ backgroundColor: token.logoColor }}
      >
        <InlineText color="white" fontWeight="900" fontSize={size * 0.42}>
          {token.symbol[0]}
        </InlineText>
      </Stack>
      <Stack
        position="absolute"
        right={-2}
        bottom={-2}
        width={badge}
        height={badge}
        borderRadius={badge / 2}
        borderWidth={2}
        borderColor="$background"
        alignItems="center"
        justifyContent="center"
        style={{ backgroundColor: CHAINS[token.chain].color }}
        accessibilityLabel={CHAINS[token.chain].name}
        testID={`chain-badge-${token.chain}`}
      >
        <InlineText color="white" fontWeight="900" fontSize={badge * 0.55}>
          {CHAINS[token.chain].name[0]}
        </InlineText>
      </Stack>
    </Stack>
  );
}
