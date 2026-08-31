import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useRef } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import { formatDate, shortenAddress } from "../../core/i18n/format";
import { usePreferencesStore } from "../../core/preferences/preferences-store";
import {
  Body,
  Content,
  InlineText,
  Page,
  PageScroll,
  PrimaryButton,
  Row,
  ScreenHeader,
  SecondaryButton,
  Sheet,
  type SheetHandle,
  Stack,
  Switch,
  toast,
} from "../../design-system";
import type { RootStackParamList } from "../../navigation/types";
import { useApprovals } from "../dex/hooks/use-dex";
import { Group, SRow } from "../profile/profile-screen";
import { useSession, useSignOut } from "../session/hooks/use-session";
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

/** S-08 安全中心（钱包身份）：安全等级由本机可判定项计算；应用保护 / 钱包与会话 / 资金安全 三组；断开所有会话。 */
export function SecurityCenterScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "SecurityCenter">) {
  const insets = useSafeAreaInsets();
  const { config, t } = useFoundationRuntime();
  const locale = config.localization.selectedLocale;
  const prefs = usePreferencesStore();
  const session = useSession();
  const address = session.data?.address;
  const accounts = useWalletAccounts();
  const approvals = useApprovals(config.modules.dex ? address : undefined);
  const signOut = useSignOut();
  const confirm = useRef<SheetHandle>(null);

  const embedded = (accounts.data ?? []).find(
    (item) => item.connector === "embedded",
  );
  const backedUp = embedded ? embedded.backedUp : true;
  const checks = [prefs.appLockEnabled, prefs.txConfirm, backedUp];
  const passed = checks.filter(Boolean).length;
  const level = passed === 3 ? "high" : passed === 2 ? "medium" : "low";
  const suggestion = !backedUp
    ? t("security.suggest.backup")
    : !prefs.appLockEnabled
      ? t("security.suggest.appLock")
      : !prefs.txConfirm
        ? t("security.suggest.txConfirm")
        : undefined;
  const levelColor =
    level === "high" ? "$success" : level === "medium" ? "$warning" : "$danger";
  const cycleLock = () => {
    const order: (0 | 1 | 5 | 15)[] = [0, 1, 5, 15];
    const next =
      order[(order.indexOf(prefs.autoLockMinutes) + 1) % order.length] ?? 5;
    prefs.update({ autoLockMinutes: next });
  };
  const cycleThreshold = () => {
    const order = [500, 1000, 5000, 10000];
    const next =
      order[
        (order.indexOf(prefs.largeAmountThresholdUsd) + 1) % order.length
      ] ?? 1000;
    prefs.update({ largeAmountThresholdUsd: next });
  };

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={t("security.title")}
          onBack={() => navigation.goBack()}
          backLabel={t("action.back")}
        />
      </Content>
      <PageScroll>
        <Content paddingTop="$1" gap="$4" paddingBottom={40}>
          <Stack
            padding="$3"
            borderRadius="$4"
            backgroundColor="$surface"
            borderWidth={1}
            borderColor="$borderColor"
            gap="$2"
          >
            <Row alignItems="center" justifyContent="space-between">
              <Stack>
                <Body fontSize={12}>{t("security.level")}</Body>
                <InlineText fontSize={26} fontWeight="900" color={levelColor}>
                  {t(`security.level.${level}`)}
                </InlineText>
              </Stack>
              <Body fontSize={12}>
                {fill(t("security.protectionsOn"), { n: passed })}
              </Body>
            </Row>
            <Row gap="$1.5">
              {[0, 1, 2].map((index) => (
                <Stack
                  key={index}
                  flex={1}
                  height={6}
                  borderRadius={3}
                  backgroundColor={
                    index < passed ? levelColor : "$surfaceVariant"
                  }
                />
              ))}
            </Row>
            {suggestion ? (
              <Body fontSize={12} color="$warning">
                {suggestion}
              </Body>
            ) : null}
          </Stack>

          <Group title={t("security.section.protection")}>
            <SRow
              title={t("settings.appLock")}
              subtitle={t("security.appLock.hint")}
              trailing={
                <Switch
                  value={prefs.appLockEnabled}
                  onValueChange={(next) =>
                    prefs.update({ appLockEnabled: next })
                  }
                  accessibilityLabel={t("settings.appLock")}
                  testID="sec-app-lock"
                />
              }
            />
            <SRow
              title={t("security.autoLock")}
              value={
                prefs.autoLockMinutes === 0
                  ? t("security.autoLock.immediate")
                  : fill(t("security.autoLock.value"), {
                      minutes: prefs.autoLockMinutes,
                    })
              }
              onPress={cycleLock}
              testID="sec-lock-delay"
            />
            <SRow
              title={t("settings.txConfirm")}
              subtitle={t("security.txConfirm.hint")}
              trailing={
                <Switch
                  value={prefs.txConfirm}
                  onValueChange={(next) => prefs.update({ txConfirm: next })}
                  accessibilityLabel={t("settings.txConfirm")}
                  testID="sec-tx-confirm"
                />
              }
            />
            <SRow
              title={t("security.largeAmount")}
              subtitle={t("security.largeAmount.hint")}
              value={`$${prefs.largeAmountThresholdUsd.toLocaleString()}`}
              onPress={cycleThreshold}
              testID="sec-large-amount"
            />
          </Group>

          <Group title={t("security.section.wallets")}>
            <SRow
              title={t("security.connectedWallets")}
              value={(accounts.data ?? [])
                .map((item) => t(`profile.connector.${item.connector}`))
                .filter((v, i, a) => a.indexOf(v) === i)
                .join(" · ")}
              onPress={() => navigation.navigate("Wallets")}
              testID="sec-wallets"
            />
            {embedded ? (
              <SRow
                title={t("security.backup")}
                subtitle={fill(t("security.backup.hint"), {
                  address: shortenAddress(embedded.address),
                })}
                pill={embedded.backedUp ? undefined : t("security.notBackedUp")}
                value={embedded.backedUp ? t("security.backedUp") : undefined}
                onPress={() => navigation.navigate("WalletBackup")}
                testID="sec-backup"
              />
            ) : null}
            <SRow
              title={t("security.sessions")}
              value={
                session.data
                  ? fill(t("security.sessions.value"), {
                      date: formatDate(session.data.expiresAt, locale),
                    })
                  : "—"
              }
              onPress={() => toast(t("state.empty"), "info")}
              testID="sec-sessions"
            />
            <SRow
              title={t("security.loginHistory")}
              onPress={() => toast(t("state.empty"), "info")}
              testID="sec-login-history"
            />
          </Group>

          <Group title={t("security.section.funds")}>
            <SRow
              title={t("security.whitelist")}
              subtitle={t("security.whitelist.hint")}
              trailing={
                <Switch
                  value={prefs.sendWhitelistOnly}
                  onValueChange={(next) =>
                    prefs.update({ sendWhitelistOnly: next })
                  }
                  accessibilityLabel={t("security.whitelist")}
                  testID="sec-whitelist"
                />
              }
            />
            <SRow
              title={t("profile.addressBook")}
              value={fill(t("profile.addressBook.count"), { n: 2 })}
              onPress={() => toast(t("state.empty"), "info")}
              testID="sec-address-book"
            />
            {config.modules.dex ? (
              <SRow
                title={t("security.approvals")}
                subtitle={t("security.approvals.hint")}
                value={
                  approvals.data
                    ? fill(t("security.approvals.count"), {
                        n: approvals.data.length,
                      })
                    : undefined
                }
                onPress={() => navigation.navigate("Approvals")}
                testID="sec-approvals"
              />
            ) : null}
          </Group>

          {address ? (
            <SecondaryButton
              borderColor="$danger"
              color="$danger"
              onPress={() => confirm.current?.present()}
              testID="sec-disconnect-all"
            >
              {t("security.disconnectAll")}
            </SecondaryButton>
          ) : null}
        </Content>
      </PageScroll>
      <Sheet
        ref={confirm}
        title={t("security.disconnectAllConfirm")}
        closeLabel={t("common.close")}
      >
        <PrimaryButton
          backgroundColor="$danger"
          disabled={signOut.isPending}
          onPress={() =>
            signOut.mutate(undefined, {
              onSuccess: () => {
                confirm.current?.dismiss();
                toast(t("account.disconnected"), "info");
                navigation.popToTop();
              },
            })
          }
          testID="sec-disconnect-all-confirm"
        >
          {t("security.disconnectAll")}
        </PrimaryButton>
        <SecondaryButton onPress={() => confirm.current?.dismiss()}>
          {t("common.cancel")}
        </SecondaryButton>
      </Sheet>
    </Page>
  );
}
