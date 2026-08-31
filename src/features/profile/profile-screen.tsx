import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import { formatDate, formatUsd, shortenAddress } from "../../core/i18n/format";
import { toApproxNumber } from "../../core/money/money";
import { usePreferencesStore } from "../../core/preferences/preferences-store";
import {
  AppIcon,
  type AppIconName,
  Badge,
  Body,
  Content,
  IconButton,
  InlineText,
  Label,
  Page,
  PageScroll,
  PrimaryButton,
  Row,
  SecondaryButton,
  SectionTitle,
  Sheet,
  type SheetHandle,
  Stack,
  toast,
} from "../../design-system";
import type { RootStackParamList } from "../../navigation/types";
import { ReceiveSheet } from "../assets/ui/receive-sheet";
import { usePredictBalance } from "../predict/hooks/use-predict";
import { useSession, useSignOut } from "../session/hooks/use-session";
import { requestAuth } from "../session/model/auth-sheet-store";
import { useWalletAccounts } from "../wallet/hooks/use-wallet";

function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, String(value)),
    template,
  );
}

/** S-01 个人中心（钱包身份）：头部身份卡、快捷格、钱包 / 我的 / 更多 三组、断开连接并退出。 */
export function ProfileScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "Profile">) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const session = useSession();
  const address = session.data?.address;
  const accounts = useWalletAccounts();
  const balance = usePredictBalance(
    config.modules.predict ? address : undefined,
  );
  const signOut = useSignOut();
  const appLock = usePreferencesStore((state) => state.appLockEnabled);
  const receive = useRef<SheetHandle>(null);
  const logout = useRef<SheetHandle>(null);
  const hasUpdate = config.update.decision !== "none";

  // 游客态：直接拉起登录 sheet，不显示空页面
  useEffect(() => {
    if (!session.isLoading && !address) {
      requestAuth();
      navigation.goBack();
    }
  }, [address, navigation, session.isLoading]);

  if (!address) return <Page />;
  const connector = session.data?.connector ?? "metamask";
  const claimable = balance.data ? toApproxNumber(balance.data.claimable) : 0;
  const positionsUsd = balance.data
    ? toApproxNumber(balance.data.positionsValue)
    : 0;

  return (
    <Page>
      <PageScroll>
        <Content paddingTop={insets.top + 8} gap="$4" paddingBottom={40}>
          <Row justifyContent="flex-end" gap="$2">
            <IconButton
              label={t("home.notifications")}
              icon="bell-outline"
              size={32}
              onPress={() => navigation.navigate("NotificationSettings")}
              testID="profile-notifications"
            />
            <IconButton
              label={t("settings.title")}
              icon="cog-outline"
              size={32}
              onPress={() => navigation.navigate("Settings")}
              testID="profile-settings"
            />
          </Row>
          <Row
            alignItems="center"
            gap="$3"
            onPress={() => navigation.navigate("Wallets")}
            accessibilityRole="button"
            testID="profile-identity"
          >
            <Stack
              width={56}
              height={56}
              borderRadius={28}
              backgroundColor="$primary"
              alignItems="center"
              justifyContent="center"
            >
              <InlineText color="$onPrimary" fontWeight="900" fontSize={18}>
                {address.slice(2, 4).toUpperCase()}
              </InlineText>
            </Stack>
            <Stack flex={1} gap="$1">
              <Row alignItems="center" gap="$2">
                <SectionTitle fontSize={18}>
                  {session.data?.ens ?? shortenAddress(address)}
                </SectionTitle>
                <Badge paddingVertical={2}>
                  <InlineText fontSize={10} fontWeight="800" color="$textMuted">
                    {t(`profile.connector.${connector}`)}
                  </InlineText>
                </Badge>
              </Row>
              <Row
                alignItems="center"
                gap="$1"
                onPress={() =>
                  void Clipboard.setStringAsync(address).then(() =>
                    toast(t("receive.copied"), "success"),
                  )
                }
                accessibilityRole="button"
                accessibilityLabel={t("account.copy")}
              >
                <Body fontSize={12}>
                  {shortenAddress(address)} ·{" "}
                  {fill(t("profile.chains"), {
                    n: session.data?.chains.length ?? 0,
                  })}
                </Body>
                <AppIcon name="content-copy" size={12} colorToken="textMuted" />
              </Row>
            </Stack>
            <AppIcon name="chevron-right" size={20} colorToken="textMuted" />
          </Row>

          <Row gap="$2">
            <QuickCell
              icon="qrcode"
              label={t("profile.receiveQr")}
              onPress={() => receive.current?.present()}
              testID="profile-receive"
            />
            <QuickCell
              icon="shield-check-outline"
              label={t("profile.securityCenter")}
              onPress={() => navigation.navigate("SecurityCenter")}
              testID="profile-security-quick"
            />
            <QuickCell
              icon="gift-outline"
              label={t("profile.referral")}
              onPress={() => toast(t("state.empty"), "info")}
              testID="profile-referral"
            />
            <QuickCell
              icon="headset"
              label={t("profile.support")}
              onPress={() => toast(t("state.empty"), "info")}
              testID="profile-support"
            />
          </Row>

          <Group title={t("profile.section.wallet")}>
            <SRow
              icon="wallet-outline"
              title={t("profile.wallets")}
              subtitle={t("profile.wallets.hint")}
              value={fill(t("profile.wallets.count"), {
                n: accounts.data?.length ?? 1,
              })}
              onPress={() => navigation.navigate("Wallets")}
              testID="profile-wallets"
            />
            <SRow
              icon="shield-check-outline"
              title={t("profile.securityCenter")}
              value={appLock ? t("profile.appLockOn") : t("profile.appLockOff")}
              onPress={() => navigation.navigate("SecurityCenter")}
              testID="profile-security"
            />
            <SRow
              icon="book-account-outline"
              title={t("profile.addressBook")}
              value={fill(t("profile.addressBook.count"), { n: 2 })}
              onPress={() => toast(t("state.empty"), "info")}
              testID="profile-address-book"
            />
          </Group>

          <Group title={t("profile.section.mine")}>
            {config.modules.predict ? (
              <SRow
                icon="chart-timeline-variant"
                title={t("profile.predictPortfolio")}
                value={formatUsd(positionsUsd, locale)}
                pill={claimable > 0 ? t("profile.claimable") : undefined}
                onPress={() => navigation.navigate("Positions")}
                testID="profile-predict-portfolio"
              />
            ) : null}
            {config.modules.dex ? (
              <SRow
                icon="star-outline"
                title={t("profile.watchlist")}
                value={fill(t("profile.watchlist.count"), { n: 1 })}
                onPress={() => navigation.navigate("AppShell")}
                testID="profile-watchlist"
              />
            ) : null}
            <SRow
              icon="history"
              title={t("profile.history")}
              onPress={() => {
                if (config.modules.dex) navigation.navigate("SwapHistory");
                else navigation.navigate("AccountDetail", { kind: "predict" });
              }}
              testID="profile-history"
            />
          </Group>

          <Group title={t("profile.section.more")}>
            <SRow
              icon="gift-outline"
              title={t("profile.referral")}
              value={fill(t("profile.referralCount"), { n: 12 })}
              onPress={() => toast(t("state.empty"), "info")}
              testID="profile-referral-row"
            />
            <SRow
              icon="help-circle-outline"
              title={t("home.support")}
              onPress={() => toast(t("state.empty"), "info")}
              testID="profile-support-row"
            />
            <SRow
              icon="information-outline"
              title={t("profile.about")}
              value={config.app.version}
              dot={hasUpdate}
              onPress={() => navigation.navigate("About")}
              testID="profile-about"
            />
          </Group>

          <Stack gap="$1" alignItems="center">
            <SecondaryButton
              onPress={() => logout.current?.present()}
              testID="profile-logout"
              alignSelf="stretch"
            >
              {t("profile.disconnect")}
            </SecondaryButton>
            <Body fontSize={11}>
              {session.data
                ? fill(t("profile.sessionUntil"), {
                    date: formatDate(session.data.expiresAt, locale),
                  })
                : ""}{" "}
              ·{" "}
              <InlineText
                fontSize={11}
                color="$primary"
                onPress={() => navigation.navigate("SecurityCenter")}
              >
                {t("profile.manageSessions")}
              </InlineText>
            </Body>
          </Stack>
        </Content>
      </PageScroll>
      <ReceiveSheet
        ref={receive}
        address={address}
        ens={session.data?.ens}
        chains={session.data?.chains ?? ["bsc"]}
      />
      <Sheet
        ref={logout}
        title={t("profile.logoutConfirm")}
        closeLabel={t("common.close")}
      >
        <Body>{t("profile.logoutHint")}</Body>
        <PrimaryButton
          disabled={signOut.isPending}
          onPress={() =>
            signOut.mutate(undefined, {
              onSuccess: () => {
                logout.current?.dismiss();
                toast(t("account.disconnected"), "info");
                navigation.popToTop();
              },
            })
          }
          testID="profile-logout-confirm"
        >
          {t("profile.disconnect")}
        </PrimaryButton>
        <SecondaryButton onPress={() => logout.current?.dismiss()}>
          {t("common.cancel")}
        </SecondaryButton>
      </Sheet>
    </Page>
  );
}

function QuickCell({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: AppIconName;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Stack
      flex={1}
      alignItems="center"
      gap="$1.5"
      paddingVertical="$3"
      borderRadius="$4"
      backgroundColor="$surfaceVariant"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      pressStyle={{ opacity: 0.8 }}
    >
      <AppIcon name={icon} size={22} colorToken="primary" />
      <InlineText fontSize={12} fontWeight="600">
        {label}
      </InlineText>
    </Stack>
  );
}

export function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Stack gap="$1.5">
      <Label>{title}</Label>
      <Stack
        borderRadius="$4"
        backgroundColor="$surface"
        borderWidth={1}
        borderColor="$borderColor"
        paddingHorizontal="$3"
      >
        {children}
      </Stack>
    </Stack>
  );
}

/** 设置行：跳转（值 + 箭头）/ 开关（trailing）/ 带红点。 */
export function SRow({
  icon,
  title,
  subtitle,
  value,
  pill,
  dot,
  trailing,
  onPress,
  testID,
  danger,
}: {
  icon?: AppIconName;
  title: string;
  subtitle?: string;
  value?: string;
  pill?: string;
  dot?: boolean;
  trailing?: React.ReactNode;
  onPress?: () => void;
  testID?: string;
  danger?: boolean;
}) {
  return (
    <Row
      alignItems="center"
      gap="$3"
      minHeight={56}
      paddingVertical="$2.5"
      borderBottomWidth={1}
      borderColor="$borderColor"
      onPress={onPress}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={title}
      testID={testID}
      pressStyle={onPress ? { opacity: 0.7 } : undefined}
    >
      {icon ? (
        <AppIcon
          name={icon}
          size={20}
          colorToken={danger ? "danger" : "textMuted"}
        />
      ) : null}
      <Stack flex={1} gap="$0.5">
        <InlineText
          fontSize={15}
          fontWeight="600"
          color={danger ? "$danger" : "$color"}
        >
          {title}
        </InlineText>
        {subtitle ? <Body fontSize={12}>{subtitle}</Body> : null}
      </Stack>
      {pill ? (
        <Badge borderWidth={0} backgroundColor="$primary" paddingVertical={2}>
          <InlineText fontSize={10} fontWeight="800" color="$onPrimary">
            {pill}
          </InlineText>
        </Badge>
      ) : null}
      {value ? (
        <Body fontSize={13} color="$textMuted">
          {value}
        </Body>
      ) : null}
      {dot ? (
        <Stack
          width={8}
          height={8}
          borderRadius={4}
          backgroundColor="$danger"
        />
      ) : null}
      {trailing}
      {onPress && !trailing ? (
        <AppIcon name="chevron-right" size={18} colorToken="textMuted" />
      ) : null}
    </Row>
  );
}
