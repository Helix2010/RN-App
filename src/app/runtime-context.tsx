import { getLocales } from "expo-localization";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState, BackHandler, Modal, useColorScheme } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import type { BootstrapSnapshot } from "../core/config/bootstrap-repository";
import type {
  BootstrapConfig,
  SupportedLocale,
} from "../core/config/bootstrap.schema";
import { createFallbackConfig } from "../core/config/fallback-config";
import { translateMessage } from "../core/config/localization";
import { useBootstrap } from "../core/config/use-bootstrap";
import { loadBootstrap } from "../core/config/bootstrap-repository";
import { changeLocalePreference } from "../core/config/locale-change";
import {
  usePreferencesStore,
  type LocalePreference,
  type ThemePreference,
} from "../core/preferences/preferences-store";
import {
  applyDownloadedOta,
  checkAndDownloadOta,
  type OtaCheckResult,
} from "../core/updates/update-service";
import { useUpdateStatus } from "../core/updates/use-update-status";
import {
  Body,
  Card,
  FoundationThemeProvider,
  Label,
  PrimaryButton,
  SectionTitle,
  Stack,
} from "../design-system";
import { LaunchScreen } from "./launch-screen";
import { BootstrapSkeleton } from "./bootstrap-skeleton";
import {
  registerPushTokenIfAuthorized,
  subscribeToUpdateSignals,
} from "../core/device/installation-service";
import {
  collectBrandingAssets,
  hydrateCachedBranding,
  resolveBrandingVisual,
  warmBrandingAssets,
} from "../core/config/branding-assets";

type RuntimeValue = {
  config: BootstrapConfig;
  snapshot: BootstrapSnapshot;
  localePreference: LocalePreference;
  themePreference: ThemePreference;
  setLocale: (locale: LocalePreference) => Promise<void>;
  setTheme: (theme: ThemePreference) => void;
  t: (key: string) => string;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  refresh: () => Promise<BootstrapSnapshot>;
  otaResult: OtaCheckResult | null;
  applyPendingOta: () => Promise<void>;
  notificationStatus: "idle" | "registered" | "denied" | "unavailable";
  enableUpdateNotifications: () => Promise<void>;
  notificationIntent: { type: string; eventId: string } | null;
};

/** 导出仅供测试壳（src/test/harness.tsx）注入假运行时；业务代码请用 useFoundationRuntime。 */
export const RuntimeContext = createContext<RuntimeValue | null>(null);
export type { RuntimeValue };

function systemLocale(): SupportedLocale {
  return getLocales()[0]?.languageCode === "en" ? "en-US" : "zh-CN";
}

export function FoundationRuntimeProvider({ children }: PropsWithChildren) {
  const localePreference = usePreferencesStore((state) => state.locale);
  const themePreference = usePreferencesStore((state) => state.theme);
  const systemTheme = useColorScheme();
  const persistLocale = usePreferencesStore((state) => state.setLocale);
  const queryClient = useQueryClient();
  const setTheme = usePreferencesStore((state) => state.setTheme);
  const locale =
    localePreference === "system" ? systemLocale() : localePreference;
  const query = useBootstrap(locale);
  const fallback = useMemo(() => createFallbackConfig(locale), [locale]);
  const snapshot = query.data;
  // The embedded configuration is used only to render the startup gate. It is
  // never exposed through RuntimeContext and cannot open business screens.
  const config = snapshot?.config ?? fallback;
  const runtimeSnapshot = useMemo<BootstrapSnapshot>(
    () =>
      snapshot ?? {
        config: fallback,
        source: "fallback",
        stale: true,
      },
    [fallback, snapshot],
  );
  const otaLastCheckRef = useRef<{ key: string; at: number } | null>(null);
  const [otaResult, setOtaResult] = useState<OtaCheckResult | null>(null);
  const [launchMinimumElapsed, setLaunchMinimumElapsed] = useState(false);
  const [launchTimeout, setLaunchTimeout] = useState(false);
  const [launchBranding, setLaunchBranding] = useState(config.branding);
  const [launchBrandingVersion, setLaunchBrandingVersion] = useState<
    number | null
  >(null);
  const [notificationStatus, setNotificationStatus] = useState<
    "idle" | "registered" | "denied" | "unavailable"
  >("idle");
  const [notificationIntent, setNotificationIntent] = useState<{
    type: string;
    eventId: string;
  } | null>(null);
  const launchTheme =
    themePreference === "system"
      ? systemTheme === "dark"
        ? "dark"
        : "light"
      : themePreference;
  const activeBranding =
    config.branding && launchBrandingVersion === config.branding.version
      ? launchBranding
      : config.branding;
  const launchVisual = activeBranding
    ? resolveBrandingVisual(activeBranding.launch.visuals, launchTheme)
    : undefined;
  const brandingReady =
    !config.branding || launchBrandingVersion === config.branding.version;
  const nativeUpdateStatus = useUpdateStatus();
  const t = useCallback(
    (key: string) => translateMessage(config.localization.messages, key),
    [config.localization.messages],
  );
  const setLocale = useCallback(
    async (nextPreference: LocalePreference): Promise<void> => {
      await changeLocalePreference({
        preference: nextPreference,
        currentPreference: localePreference,
        systemLocale: systemLocale(),
        stage: async (targetLocale) => {
          await queryClient.fetchQuery({
            queryKey: ["mobile-bootstrap", targetLocale],
            queryFn: ({ signal }) => loadBootstrap(targetLocale, signal),
            staleTime: 5 * 60 * 1_000,
            gcTime: 24 * 60 * 60 * 1_000,
            retry: false,
          });
        },
        commit: persistLocale,
      });
    },
    [localePreference, persistLocale, queryClient],
  );
  const refresh = useCallback(async (): Promise<BootstrapSnapshot> => {
    const result = await query.refetch();
    if (result.data) return result.data;
    if (snapshot) return snapshot;
    throw result.error ?? new Error("Remote Bootstrap is unavailable");
  }, [query, snapshot]);
  useEffect(() => {
    const minimumMs = config.branding?.launch.minDisplayMs ?? 700;
    const maximumMs = config.branding?.launch.maxDisplayMs ?? 1_800;
    const minimumTimer = setTimeout(
      () => setLaunchMinimumElapsed(true),
      minimumMs,
    );
    const timeoutTimer = setTimeout(() => setLaunchTimeout(true), maximumMs);
    return () => {
      clearTimeout(minimumTimer);
      clearTimeout(timeoutTimer);
    };
  }, [
    config.branding?.launch.maxDisplayMs,
    config.branding?.launch.minDisplayMs,
  ]);
  useEffect(() => {
    let active = true;
    const remoteBranding = config.branding;
    if (!remoteBranding) return () => undefined;
    void hydrateCachedBranding({ ...config, branding: remoteBranding }).then(
      (cached) => {
        if (active && cached.branding) {
          setLaunchBranding(cached.branding);
          setLaunchBrandingVersion(cached.branding.version);
        }
      },
    );
    void warmBrandingAssets(
      collectBrandingAssets(config),
      remoteBranding.cachePolicy,
    ).then(() => {
      if (!active) return;
      void hydrateCachedBranding({ ...config, branding: remoteBranding }).then(
        (cached) => {
          if (active && cached.branding) {
            setLaunchBranding(cached.branding);
            setLaunchBrandingVersion(cached.branding.version);
          }
        },
      );
    });
    return () => {
      active = false;
    };
  }, [config]);
  const runSilentOtaCheck = useCallback((candidate: BootstrapConfig) => {
    if (!candidate.features.otaEnabled || !candidate.update.ota.enabled) return;
    const key = [
      candidate.configVersion,
      candidate.features.otaEnabled,
      candidate.update.ota.enabled,
      candidate.update.ota.channel,
      candidate.update.ota.runtimeVersion,
    ].join(":");
    const now = Date.now();
    const previous = otaLastCheckRef.current;
    if (previous?.key === key && now - previous.at < 15 * 60 * 1_000) return;
    otaLastCheckRef.current = { key, at: now };
    // OTA is deliberately a background, non-blocking operation. The native
    // module uses checkAutomatically=NEVER, so this path observes the tenant
    // Bootstrap policy without blocking startup or user interaction.
    void checkAndDownloadOta(candidate, {
      onStateChange: (status) =>
        setOtaResult((previous) => (previous ? { ...previous, status } : null)),
    }).then(setOtaResult);
  }, []);
  useEffect(() => {
    if (snapshot && !query.isPending && !snapshot.stale)
      runSilentOtaCheck(config);
  }, [config, query.isPending, runSilentOtaCheck, snapshot]);
  useEffect(() => {
    const interval = 15 * 60 * 1_000;
    const refreshAndCheck = (): void => {
      if (AppState.currentState !== "active") return;
      void query.refetch().then((result) => {
        if (result.data && !result.data.stale)
          runSilentOtaCheck(result.data.config);
      });
    };
    const timer = setInterval(refreshAndCheck, interval);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshAndCheck();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [config.localization.refreshIntervalSeconds, query, runSilentOtaCheck]);
  useEffect(() => {
    if (!snapshot || snapshot.stale) return;
    void registerPushTokenIfAuthorized(config, themePreference).then(
      setNotificationStatus,
    );
  }, [config, snapshot, themePreference]);
  useEffect(
    () =>
      subscribeToUpdateSignals((signal) => {
        if (
          signal.type === "app_update_available" ||
          (signal.opened && signal.type === "ota_updated")
        ) {
          setNotificationIntent({
            type: signal.type,
            eventId: signal.eventId || String(Date.now()),
          });
        }
        void query.refetch().then((result) => {
          if (result.data && !result.data.stale)
            runSilentOtaCheck(result.data.config);
        });
      }),
    [query, runSilentOtaCheck],
  );
  const enableUpdateNotifications = useCallback(async () => {
    setNotificationStatus(
      await registerPushTokenIfAuthorized(config, themePreference, true),
    );
  }, [config, themePreference]);
  const pendingOta = useMemo(
    () =>
      otaResult &&
      (otaResult.status === "ready" ||
        (otaResult.metadata.applyStrategy === "immediate" &&
          (otaResult.status === "applying" || otaResult.status === "error")))
        ? otaResult
        : nativeUpdateStatus.status === "ready"
          ? {
              ...nativeUpdateStatus,
              metadata: {
                ...nativeUpdateStatus.metadata,
                applyStrategy:
                  config.update.ota.applyStrategy ??
                  nativeUpdateStatus.metadata.applyStrategy,
              },
            }
          : null,
    [config.update.ota.applyStrategy, nativeUpdateStatus, otaResult],
  );
  const applyPendingOta = useCallback(async () => {
    if (!pendingOta || pendingOta.status === "applying") return;
    setOtaResult({
      ...pendingOta,
      status: "applying",
      messageKey: "update.otaApplying",
    });
    try {
      await applyDownloadedOta(pendingOta.metadata.applyStrategy);
    } catch {
      setOtaResult({
        ...pendingOta,
        status: "error",
        messageKey: "update.otaError",
      });
    }
  }, [pendingOta]);
  const immediateOtaVisible =
    pendingOta?.metadata.applyStrategy === "immediate" &&
    (pendingOta.status === "ready" ||
      pendingOta.status === "applying" ||
      pendingOta.status === "error");
  useEffect(() => {
    if (!immediateOtaVisible) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => true,
    );
    return () => subscription.remove();
  }, [immediateOtaVisible]);
  const value = useMemo<RuntimeValue>(
    () => ({
      config,
      snapshot: runtimeSnapshot,
      localePreference,
      themePreference,
      setLocale,
      setTheme,
      t,
      isInitialLoading: query.isPending,
      isRefreshing: query.isFetching && !query.isPending,
      refresh,
      otaResult,
      applyPendingOta,
      notificationStatus,
      enableUpdateNotifications,
      notificationIntent,
    }),
    [
      config,
      applyPendingOta,
      localePreference,
      query.isFetching,
      query.isPending,
      refresh,
      setLocale,
      setTheme,
      runtimeSnapshot,
      t,
      themePreference,
      otaResult,
      notificationStatus,
      enableUpdateNotifications,
      notificationIntent,
    ],
  );

  return (
    <FoundationThemeProvider config={config} preference={themePreference}>
      {!snapshot ? (
        query.isPending ? (
          launchMinimumElapsed ? (
            <BootstrapSkeleton />
          ) : (
            <LaunchScreen
              message={
                locale === "en-US"
                  ? "Connecting to configuration service"
                  : "正在连接配置服务"
              }
            />
          )
        ) : (
          <BootstrapUnavailableScreen
            locale={locale}
            retrying={query.isFetching}
            onRetry={() => void query.refetch()}
          />
        )
      ) : (
        <RuntimeContext.Provider value={value}>
          {launchMinimumElapsed &&
          (!query.isPending || launchTimeout) &&
          (brandingReady || launchTimeout) ? (
            children
          ) : (
            <LaunchScreen
              message={activeBranding?.launch.subtitle || t("status.loading")}
              title={activeBranding?.launch.title || t("app.name")}
              backgroundColor={launchVisual?.backgroundColor}
              logo={launchVisual?.logo}
              backgroundImage={launchVisual?.backgroundImage}
              animationType={activeBranding?.launch.animation.type}
              animationDurationMs={activeBranding?.launch.animation.durationMs}
            />
          )}
          <Modal
            visible={immediateOtaVisible}
            transparent
            animationType="fade"
            statusBarTranslucent
            navigationBarTranslucent
            presentationStyle="overFullScreen"
            onRequestClose={() => undefined}
          >
            <FoundationThemeProvider
              config={config}
              preference={themePreference}
            >
              <Stack
                flex={1}
                justifyContent="center"
                padding="$4"
                backgroundColor="$backdrop"
                accessibilityRole="alert"
                accessibilityViewIsModal
              >
                {pendingOta ? (
                  <Card
                    width="100%"
                    maxWidth={460}
                    alignSelf="center"
                    borderColor="$warning"
                    backgroundColor="$surface"
                    padding="$5"
                  >
                    <Stack gap="$3">
                      <Label color="$warning">
                        {t("update.otaImmediateRequiredLabel")}
                      </Label>
                      <SectionTitle>
                        {t(
                          pendingOta.status === "error"
                            ? "update.otaImmediateRetryTitle"
                            : "update.otaImmediateTitle",
                        )}
                      </SectionTitle>
                      <Body>
                        {t(
                          pendingOta.status === "applying"
                            ? "update.otaApplying"
                            : pendingOta.status === "error"
                              ? "update.otaImmediateRetry"
                              : "update.otaImmediateRequired",
                        )}
                      </Body>
                      <Stack
                        padding="$3"
                        borderRadius="$3"
                        backgroundColor="$surfaceVariant"
                      >
                        <Body color="$textMuted" fontSize={13}>
                          {t("update.otaImmediateHint")}
                        </Body>
                      </Stack>
                      <PrimaryButton
                        disabled={pendingOta.status === "applying"}
                        onPress={() => void applyPendingOta()}
                      >
                        {pendingOta.status === "applying"
                          ? t("update.otaApplying")
                          : t("update.applyImmediate")}
                      </PrimaryButton>
                    </Stack>
                  </Card>
                ) : null}
              </Stack>
            </FoundationThemeProvider>
          </Modal>
        </RuntimeContext.Provider>
      )}
    </FoundationThemeProvider>
  );
}

function BootstrapUnavailableScreen({
  locale,
  retrying,
  onRetry,
}: {
  locale: SupportedLocale;
  retrying: boolean;
  onRetry: () => void;
}) {
  const english = locale === "en-US";
  return (
    <Stack
      flex={1}
      justifyContent="center"
      padding="$4"
      backgroundColor="$background"
      accessibilityRole="alert"
    >
      <Card width="100%" maxWidth={460} alignSelf="center" padding="$5">
        <Stack gap="$3">
          <Label color="$danger">
            {english ? "CONFIGURATION UNAVAILABLE" : "配置连接失败"}
          </Label>
          <SectionTitle>
            {english ? "Unable to start the app" : "暂时无法启动应用"}
          </SectionTitle>
          <Body>
            {english
              ? "No valid remote or cached configuration is available. Check your network and try again."
              : "当前没有可用的远程配置或有效缓存。请检查网络后重新连接。"}
          </Body>
          <Body color="$textMuted" fontSize={13}>
            {english
              ? "Business pages remain locked until configuration validation succeeds."
              : "配置校验成功前不会进入业务页面。"}
          </Body>
          <PrimaryButton disabled={retrying} onPress={onRetry}>
            {retrying
              ? english
                ? "Connecting…"
                : "正在连接…"
              : english
                ? "Try again"
                : "重新连接"}
          </PrimaryButton>
        </Stack>
      </Card>
    </Stack>
  );
}

export function useFoundationRuntime(): RuntimeValue {
  const value = useContext(RuntimeContext);
  if (!value) {
    throw new Error(
      "useFoundationRuntime must be used inside FoundationRuntimeProvider",
    );
  }
  return value;
}
