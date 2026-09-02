import { useNavigation } from "@react-navigation/native";
import { fill, formatMoney, shortenAddress } from "../../../core/i18n/format";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useEffect, useRef } from "react";
import { useFoundationRuntime } from "../../../app/runtime-context";
import {
  AppIcon,
  Body,
  DetailRow,
  InlineText,
  Label,
  PrimaryButton,
  Row,
  SecondaryButton,
  SectionTitle,
  Sheet,
  SkeletonBlock,
  Stack,
  toast,
  type SheetHandle,
} from "../../../design-system";
import {
  useWalletAccounts,
  useWalletBalances,
  useWalletConnectors,
} from "../../wallet/hooks/use-wallet";
import type { WalletConnector } from "../../wallet/model/wallet";
import { tenantDomain, useWalletLogin } from "../hooks/use-session";
import { useAuthSheet } from "../model/auth-sheet-store";
import type { AuthIntent, WalletConnectorId } from "../model/session";
import type { RootStackParamList } from "../../../navigation/types";

function intentLabel(
  intent: AuthIntent,
  t: (key: string) => string,
): string | undefined {
  switch (intent.type) {
    case "open_order":
      return fill(t("login.intent.order"), {
        outcome: intent.outcome === "yes" ? "Yes" : "No",
      });
    case "open_swap":
      return t("login.intent.swap");
    case "open_transfer":
      return t("login.intent.transfer");
    case "open_tab":
      return intent.tab === "assets"
        ? t("login.intent.assets")
        : t("login.intent.positions");
    case "toggle_watchlist":
      return t("login.intent.watchlist");
    default:
      return undefined;
  }
}

/**
 * 全局登录 sheet（L-02 选择钱包 → L-03 签名确认）。由 `useAuthSheet` 驱动，挂在根组件。
 */
export function ConnectWalletSheet() {
  const { t } = useFoundationRuntime();
  const { open, intent, close, fulfill } = useAuthSheet();
  const sheet = useRef<SheetHandle>(null);
  const login = useWalletLogin(tenantDomain(), t("login.reason"));
  const connectors = useWalletConnectors();
  const accounts = useWalletAccounts();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const hasEmbedded = (accounts.data ?? []).some(
    (account) => account.connector === "embedded",
  );
  const goToWallet = (screen: "WalletSetup" | "WalletImport") => {
    close();
    login.reset();
    navigation.navigate(screen);
  };

  // 只在 open 真正翻转时 present / dismiss；挂载时不调用 dismiss（gorhom 会把延迟的 onDismiss 回调打到随后的 present 上）
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      wasOpen.current = true;
      sheet.current?.present();
    } else if (!open && wasOpen.current) {
      wasOpen.current = false;
      sheet.current?.dismiss();
    }
  }, [open]);

  const action = intentLabel(intent, t);
  const busy =
    login.state.step === "connecting" || login.state.step === "signing";
  const locked = login.state.step === "signing";

  const onSign = async () => {
    const session = await login.sign();
    if (session) {
      toast(t("login.success"), "success");
      fulfill();
    } else if (login.state.step === "error") {
      toast(t("login.cancelled"), "warning");
    }
  };

  // 没有钱包时不要停在一个点不动的 sheet 上，直接把用户带到创建 / 导入
  useEffect(() => {
    if (login.state.step === "needs-wallet") goToWallet("WalletSetup");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login.state.step]);

  // 连接阶段失败会退回钱包列表。不吭一声的话用户只看到列表复原，
  // 以为自己没点上——必须说清是超时还是失败。
  const reportedError = useRef<string | null>(null);
  useEffect(() => {
    const state = login.state;
    if (state.step !== "error" || state.account) {
      reportedError.current = null;
      return;
    }
    const key = `${state.connector}:${state.reason}`;
    if (reportedError.current === key) return;
    reportedError.current = key;
    const wallet =
      (connectors.data ?? []).find((item) => item.id === state.connector)
        ?.name ?? state.connector;
    toast(
      fill(
        t(
          state.reason === "timeout"
            ? "login.connectTimeout"
            : state.reason === "noChain"
              ? "login.noEnabledChain"
              : "login.connectFailed",
        ),
        { wallet },
      ),
      state.reason === "timeout" ? "warning" : "error",
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [login.state]);

  const onDismiss = () => {
    wasOpen.current = false;
    login.reset();
    if (useAuthSheet.getState().open) close();
  };

  const picking =
    login.state.step === "pick" ||
    login.state.step === "needs-wallet" ||
    login.state.step === "connecting" ||
    (login.state.step === "error" && !login.state.account);

  return (
    <Sheet
      ref={sheet}
      title={picking ? t("home.connectWallet") : t("login.confirmTitle")}
      subtitle={
        picking && action ? fill(t("login.continueTo"), { action }) : undefined
      }
      locked={locked}
      closeLabel={t("common.close")}
      onDismiss={onDismiss}
      testID="login-sheet"
      footer={
        picking ? (
          <Body fontSize={11} textAlign="center">
            {t("login.terms")}
          </Body>
        ) : undefined
      }
    >
      {picking ? (
        <ConnectorPicker
          connectors={connectors.data ?? []}
          loading={connectors.isLoading}
          busyConnector={
            login.state.step === "connecting"
              ? login.state.connector
              : undefined
          }
          onPick={(id) => void login.connect(id)}
          hasEmbedded={hasEmbedded}
          onCreate={() => goToWallet("WalletSetup")}
          onImport={() => goToWallet("WalletImport")}
          t={t}
        />
      ) : (
        <SignConfirm
          login={login}
          busy={busy}
          onSign={() => void onSign()}
          t={t}
        />
      )}
    </Sheet>
  );
}

function ConnectorPicker({
  connectors,
  loading,
  busyConnector,
  onPick,
  hasEmbedded,
  onCreate,
  onImport,
  t,
}: {
  connectors: WalletConnector[];
  loading: boolean;
  busyConnector?: WalletConnectorId;
  onPick: (id: WalletConnectorId) => void;
  /** 本机已有自托管钱包 => 第一行是"使用内置钱包"，否则是"创建钱包" */
  hasEmbedded: boolean;
  onCreate: () => void;
  onImport: () => void;
  t: (key: string) => string;
}) {
  if (loading) {
    return (
      <Stack gap="$2">
        <SkeletonBlock height={56} />
        <SkeletonBlock height={56} />
        <SkeletonBlock height={56} />
      </Stack>
    );
  }
  const embedded = connectors.filter((item) => item.kind === "embedded");
  const external = connectors
    .filter((item) => item.kind === "external" && item.id !== "walletconnect")
    .sort((a, b) => Number(b.installed) - Number(a.installed));
  const externalAvailable =
    connectors.find((item) => item.id === "walletconnect")?.configured ?? false;
  return (
    <Stack gap="$3">
      {embedded.length ? (
        <Stack gap="$1">
          <Label>{t("login.builtin")}</Label>
          <ConnectorRow
            icon="wallet-plus-outline"
            title={hasEmbedded ? t("login.useWallet") : t("login.createWallet")}
            subtitle={
              hasEmbedded ? t("login.useWalletHint") : t("login.createHint")
            }
            testID="login-create"
            busy={busyConnector === "embedded"}
            onPress={() => (hasEmbedded ? onPick("embedded") : onCreate())}
          />
          <ConnectorRow
            icon="key-outline"
            title={t("login.importWallet")}
            subtitle={t("login.importHint")}
            testID="login-import"
            onPress={onImport}
          />
        </Stack>
      ) : null}
      <Stack gap="$1">
        <Label>{t("login.external")}</Label>
        {external.map((item) => (
          <ConnectorRow
            key={item.id}
            letter={item.name[0]}
            color={item.logoColor}
            title={item.name}
            subtitle={
              busyConnector === item.id
                ? fill(t("login.opening"), { wallet: item.name })
                : !item.configured
                  ? t("login.unavailable")
                  : item.installed
                    ? t("login.installed")
                    : t("login.notInstalled")
            }
            testID={`login-wc-${item.id}`}
            busy={busyConnector === item.id}
            // 只有租户没配 projectId 才置灰。没装钱包仍然可点——会退到扫码，
            // 置灰反而变成"点了没反应"
            disabled={!item.configured}
            onPress={() => onPick(item.id)}
          />
        ))}
        <ConnectorRow
          icon="qrcode-scan"
          title={t("login.otherWallet")}
          subtitle={
            externalAvailable ? t("login.otherHint") : t("login.unavailable")
          }
          testID="login-wc-other"
          disabled={!externalAvailable}
          onPress={() => onPick("walletconnect")}
          busy={busyConnector === "walletconnect"}
        />
      </Stack>
    </Stack>
  );
}

function ConnectorRow({
  icon,
  letter,
  color,
  title,
  subtitle,
  busy,
  disabled,
  onPress,
  testID,
}: {
  icon?: Parameters<typeof AppIcon>[0]["name"];
  letter?: string;
  color?: string;
  title: string;
  subtitle?: string;
  busy?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Row
      alignItems="center"
      gap="$3"
      paddingVertical="$2.5"
      paddingHorizontal="$3"
      borderRadius="$4"
      backgroundColor="$surfaceVariant"
      onPress={busy || disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ busy, disabled }}
      testID={testID}
      pressStyle={{ opacity: disabled ? 1 : 0.75 }}
      opacity={disabled ? 0.45 : busy ? 0.7 : 1}
    >
      <Stack
        width={36}
        height={36}
        borderRadius={12}
        alignItems="center"
        justifyContent="center"
        backgroundColor="$surface"
        style={color ? { backgroundColor: color } : undefined}
      >
        {icon ? (
          <AppIcon name={icon} size={20} />
        ) : (
          <InlineText color="white" fontWeight="900">
            {letter}
          </InlineText>
        )}
      </Stack>
      <Stack flex={1}>
        <SectionTitle fontSize={15}>{title}</SectionTitle>
        {subtitle ? <Body fontSize={12}>{subtitle}</Body> : null}
      </Stack>
      <AppIcon
        name={busy ? "progress-clock" : "chevron-right"}
        size={20}
        colorToken="textMuted"
      />
    </Row>
  );
}

function SignConfirm({
  login,
  busy,
  onSign,
  t,
}: {
  login: ReturnType<typeof useWalletLogin>;
  busy: boolean;
  onSign: () => void;
  t: (key: string) => string;
}) {
  const { config } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const state = login.state;
  const account = "account" in state ? state.account : undefined;
  const connector = "connector" in state ? state.connector : undefined;
  const balances = useWalletBalances(account?.address);
  const native = balances.data?.find(
    (item) =>
      item.token.address === "native" &&
      item.token.chain === account?.chains[0],
  );
  const connectorName =
    connector === "embedded"
      ? t("login.builtin")
      : connector === "metamask"
        ? "MetaMask"
        : connector === "okx"
          ? "OKX Wallet"
          : connector === "trust"
            ? "Trust Wallet"
            : "WalletConnect";
  const error = state.step === "error" ? state.reason : undefined;
  return (
    <Stack gap="$3">
      <Row
        alignItems="center"
        gap="$3"
        padding="$3"
        borderRadius="$4"
        backgroundColor="$surfaceVariant"
      >
        <Stack
          width={40}
          height={40}
          borderRadius={20}
          backgroundColor="$primary"
          alignItems="center"
          justifyContent="center"
        >
          <InlineText color="$onPrimary" fontWeight="900">
            {account?.address.slice(2, 4).toUpperCase()}
          </InlineText>
        </Stack>
        <Stack flex={1}>
          <SectionTitle fontSize={15}>
            {fill(t("login.connected"), { wallet: connectorName })}
          </SectionTitle>
          <Body fontSize={12}>
            {account ? shortenAddress(account.address, 6, 4) : ""}
          </Body>
        </Stack>
        <Stack alignItems="flex-end">
          <Body fontSize={11}>{account?.chains[0]?.toUpperCase()}</Body>
          <InlineText fontSize={12} fontWeight="700">
            {native
              ? `${t("login.balance")} ${formatMoney(native.amount, locale, { maxFraction: 4 })}`
              : ""}
          </InlineText>
        </Stack>
      </Row>
      <Stack>
        <DetailRow label={t("login.signTo")} value={tenantDomain()} />
        <DetailRow label={t("login.purpose")} value={t("login.purposeValue")} />
        <DetailRow
          label={t("login.validity")}
          value={t("login.validityValue")}
        />
        <DetailRow
          label={t("login.fee")}
          value={t("login.feeValue")}
          tone="positive"
        />
      </Stack>
      <Body fontSize={12}>{t("login.signNote")}</Body>
      {error ? (
        <InlineText
          color={error === "timeout" ? "$warning" : "$danger"}
          fontSize={12}
          accessibilityLiveRegion="polite"
        >
          {error === "timeout" ? t("login.timeout") : t("login.cancelled")}
        </InlineText>
      ) : null}
      <PrimaryButton onPress={onSign} disabled={busy} testID="login-sign">
        {busy ? t("login.signing") : t("login.signAndLogin")}
      </PrimaryButton>
      <SecondaryButton
        onPress={login.reset}
        disabled={busy}
        testID="login-switch"
        borderWidth={error === "timeout" ? 2 : 1}
        borderColor={error === "timeout" ? "$primary" : "$borderColor"}
      >
        {t("login.switchWallet")}
      </SecondaryButton>
    </Stack>
  );
}
