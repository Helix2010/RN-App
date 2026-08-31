import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import * as Clipboard from "expo-clipboard";
import { useRef } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import {
  useAccountPrefs,
  useAccountPreferences,
} from "../../core/preferences/account-preferences-store";
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
  Switch,
  toast,
} from "../../design-system";
import type { RootStackParamList } from "../../navigation/types";
import { Group, SRow } from "../profile/profile-screen";
import { useSession } from "../session/hooks/use-session";
import { LANGUAGE_NAMES } from "./language-names";
import { useAppLockToggle } from "../security/use-app-lock-toggle";
import { useManualUpdateCheck } from "../updates/use-manual-update-check";

function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(`{${key}}`, String(value)),
    template,
  );
}

/** S-02 设置：通用 / 通知 / 交易偏好 / 安全 / 关于 五组，值列直接显示当前设置。 */
export function SettingsScreen({
  navigation,
}: NativeStackScreenProps<RootStackParamList, "Settings">) {
  const insets = useSafeAreaInsets();
  const { config, localePreference, themePreference, t } =
    useFoundationRuntime();
  const {
    state: updateCheckState,
    checking: checkingUpdate,
    check: checkUpdate,
  } = useManualUpdateCheck();
  const { toggle: toggleAppLock } = useAppLockToggle();
  const session = useSession();
  const address = session.data?.address;
  const prefs = usePreferencesStore();
  const account = useAccountPrefs(address);
  const patchAccount = useAccountPreferences((state) => state.patch);
  const clearCache = useRef<SheetHandle>(null);
  const notificationsOn = Object.entries(account.notifications).filter(
    ([key, value]) => key !== "security" && value,
  ).length;
  const hasUpdate = config.update.decision !== "none";
  const showTrading =
    Boolean(address) && (config.modules.predict || config.modules.dex);
  const languageLabel =
    localePreference === "system"
      ? t("settings.followSystemLanguage")
      : (LANGUAGE_NAMES[localePreference]?.native ?? localePreference);
  const themeLabel = t(`theme.${themePreference}`);

  return (
    <Page>
      <Content paddingTop={insets.top + 8} paddingBottom={0}>
        <ScreenHeader
          title={t("settings.title")}
          onBack={() => navigation.goBack()}
          backLabel={t("action.back")}
        />
      </Content>
      <PageScroll>
        <Content paddingTop="$1" gap="$4" paddingBottom={40}>
          <Group title={t("settings.section.general")}>
            <SRow
              title={t("settings.language")}
              value={languageLabel}
              onPress={() => navigation.navigate("LanguageSettings")}
              testID="settings-language"
            />
            <SRow
              title={t("settings.theme")}
              value={themeLabel}
              onPress={() => navigation.navigate("AppearanceSettings")}
              testID="settings-theme"
            />
            <SRow
              title={t("settings.colorScheme")}
              trailing={
                <Row gap="$1" alignItems="center">
                  <InlineText fontWeight="800" color="$pricePositive">
                    {t("settings.up")}
                  </InlineText>
                  <InlineText fontWeight="800" color="$priceNegative">
                    {t("settings.down")}
                  </InlineText>
                </Row>
              }
              onPress={() => navigation.navigate("AppearanceSettings")}
              testID="settings-color-scheme"
            />
            <SRow
              title={t("settings.quoteCurrency")}
              value={account.quoteCurrency}
              onPress={() =>
                address &&
                patchAccount(address, {
                  quoteCurrency:
                    account.quoteCurrency === "USDT" ? "USD" : "USDT",
                })
              }
              testID="settings-quote-currency"
            />
          </Group>

          <Group title={t("settings.section.notifications")}>
            <SRow
              title={t("settings.notifications")}
              value={fill(t("settings.notificationsOn"), {
                n: notificationsOn,
              })}
              onPress={() => navigation.navigate("NotificationSettings")}
              testID="settings-notifications"
            />
          </Group>

          {showTrading ? (
            <Group title={t("settings.section.trading")}>
              {config.modules.predict ? (
                <>
                  <SRow
                    title={t("settings.predictConfirm")}
                    subtitle={t("settings.predictConfirm.hint")}
                    trailing={
                      <Switch
                        value={account.predict.confirmBeforeOrder}
                        onValueChange={(next) =>
                          address &&
                          patchAccount(address, {
                            predict: {
                              ...account.predict,
                              confirmBeforeOrder: next,
                            },
                          })
                        }
                        accessibilityLabel={t("settings.predictConfirm")}
                        testID="settings-predict-confirm"
                      />
                    }
                  />
                  <SRow
                    title={t("settings.predictOrderType")}
                    value={t(
                      `settings.orderType.${account.predict.defaultOrderType}`,
                    )}
                    onPress={() =>
                      address &&
                      patchAccount(address, {
                        predict: {
                          ...account.predict,
                          defaultOrderType:
                            account.predict.defaultOrderType === "market"
                              ? "limit"
                              : "market",
                        },
                      })
                    }
                    testID="settings-predict-order-type"
                  />
                </>
              ) : null}
              {config.modules.dex ? (
                <>
                  <SRow
                    title={t("settings.dexSlippage")}
                    value={
                      account.dex.defaultSlippage === "auto"
                        ? `0.5% · ${t("settings.slippage.auto")}`
                        : `${account.dex.defaultSlippage}%`
                    }
                    onPress={() =>
                      address &&
                      patchAccount(address, {
                        dex: {
                          ...account.dex,
                          defaultSlippage:
                            account.dex.defaultSlippage === "auto" ? 1 : "auto",
                        },
                      })
                    }
                    testID="settings-dex-slippage"
                  />
                  <SRow
                    title={t("settings.dexRiskWarning")}
                    subtitle={t("settings.dexRiskWarning.hint")}
                    trailing={
                      <Switch
                        value={account.dex.riskWarning}
                        onValueChange={(next) =>
                          address &&
                          patchAccount(address, {
                            dex: { ...account.dex, riskWarning: next },
                          })
                        }
                        accessibilityLabel={t("settings.dexRiskWarning")}
                        testID="settings-dex-risk-warning"
                      />
                    }
                  />
                </>
              ) : null}
            </Group>
          ) : null}

          <Group title={t("settings.section.security")}>
            <SRow
              title={t("settings.appLock")}
              subtitle={fill(t("settings.appLock.hint"), {
                minutes: prefs.autoLockMinutes,
              })}
              trailing={
                <Switch
                  value={prefs.appLockEnabled}
                  onValueChange={(next) => void toggleAppLock(next)}
                  accessibilityLabel={t("settings.appLock")}
                  testID="settings-app-lock"
                />
              }
            />
            <SRow
              title={t("settings.txConfirm")}
              subtitle={t("settings.txConfirm.hint")}
              trailing={
                <Switch
                  value={prefs.txConfirm}
                  onValueChange={(next) => prefs.update({ txConfirm: next })}
                  accessibilityLabel={t("settings.txConfirm")}
                  testID="settings-tx-confirm"
                />
              }
            />
            <SRow
              title={t("settings.securityCenter")}
              onPress={() => navigation.navigate("SecurityCenter")}
              testID="settings-security-center"
            />
          </Group>

          <Group title={t("settings.section.about")}>
            <SRow
              title={t("settings.checkUpdate")}
              value={
                checkingUpdate
                  ? t("update.checking")
                  : updateCheckState === "error"
                    ? t("status.error")
                    : updateCheckState === "latest"
                      ? t("settings.upToDate")
                      : updateCheckState === "available" && !hasUpdate
                        ? t("update.otaReadyNextLaunch")
                        : hasUpdate
                          ? fill(t("settings.newVersion"), {
                              version: config.update.latestVersion,
                            })
                          : t("settings.upToDate")
              }
              dot={hasUpdate}
              onPress={() => void checkUpdate()}
              testID="settings-check-update"
            />
            <SRow
              title={t("settings.terms")}
              onPress={() => toast(t("state.empty"), "info")}
              testID="settings-terms"
            />
            <SRow
              title={t("settings.privacy")}
              onPress={() => toast(t("state.empty"), "info")}
              testID="settings-privacy"
            />
            <SRow
              title={t("settings.clearCache")}
              value="28.4 MB"
              onPress={() => clearCache.current?.present()}
              testID="settings-clear-cache"
            />
          </Group>

          <Body
            fontSize={11}
            textAlign="center"
            onLongPress={() =>
              void Clipboard.setStringAsync(config.support.diagnosticId).then(
                () => toast(t("receive.copied"), "success"),
              )
            }
          >
            {fill(t("settings.footer"), {
              version: config.app.version,
              build: config.app.buildNumber,
              deviceId:
                config.support.diagnosticId.slice(0, 4).toUpperCase() +
                "…" +
                config.support.diagnosticId.slice(-4).toUpperCase(),
            })}
          </Body>
        </Content>
      </PageScroll>
      <Sheet
        ref={clearCache}
        title={t("settings.clearCache")}
        closeLabel={t("common.close")}
      >
        <Body>{t("settings.clearCacheConfirm")}</Body>
        <PrimaryButton
          onPress={() => {
            clearCache.current?.dismiss();
            toast(t("settings.cacheCleared"), "success");
          }}
          testID="settings-clear-cache-confirm"
        >
          {t("common.confirm")}
        </PrimaryButton>
        <SecondaryButton onPress={() => clearCache.current?.dismiss()}>
          {t("common.cancel")}
        </SecondaryButton>
      </Sheet>
    </Page>
  );
}
