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
import type { BootstrapSnapshot } from "../core/config/bootstrap-repository";
import type {
  BootstrapConfig,
  SupportedLocale,
} from "../core/config/bootstrap.schema";
import { createFallbackConfig } from "../core/config/fallback-config";
import { translateMessage } from "../core/config/localization";
import { useBootstrap } from "../core/config/use-bootstrap";
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
import {
  registerPushTokenIfAuthorized,
  subscribeToUpdateSignals,
} from "../core/device/installation-service";
import {
  collectBrandingAssets,
  hydrateCachedBranding,
  warmBrandingAssets,
} from "../core/config/branding-assets";

type RuntimeValue = {
  config: BootstrapConfig;
  snapshot: BootstrapSnapshot;
  localePreference: LocalePreference;
  themePreference: ThemePreference;
  setLocale: (locale: LocalePreference) => void;
  setTheme: (theme: ThemePreference) => void;
  t: (key: string) => string;
  isInitialLoading: boolean;
  isRefreshing: boolean;
  refresh: () => Promise<void>;
  otaResult: OtaCheckResult | null;
  applyPendingOta: () => Promise<void>;
  notificationStatus: "idle" | "registered" | "denied" | "unavailable";
  enableUpdateNotifications: () => Promise<void>;
  notificationIntent: { type: string; eventId: string } | null;
};

const RuntimeContext = createContext<RuntimeValue | null>(null);

function systemLocale(): SupportedLocale {
  return getLocales()[0]?.languageCode === "en" ? "en-US" : "zh-CN";
}

export function FoundationRuntimeProvider({ children }: PropsWithChildren) {
  const localePreference = usePreferencesStore((state) => state.locale);
  const themePreference = usePreferencesStore((state) => state.theme);
  const systemTheme = useColorScheme();
  const setLocale = usePreferencesStore((state) => state.setLocale);
  const setTheme = usePreferencesStore((state) => state.setTheme);
  const locale =
    localePreference === "system" ? systemLocale() : localePreference;
  const query = useBootstrap(locale);
  const fallback = useMemo(() => createFallbackConfig(locale), [locale]);
  const snapshot: BootstrapSnapshot = useMemo(
    () =>
      query.data ?? {
        config: fallback,
        source: "fallback",
        stale: true,
      },
    [fallback, query.data],
  );
  const config = snapshot.config;
  const otaLastCheckRef = useRef<{ key: string; at: number } | null>(null);
  const [otaResult, setOtaResult] = useState<OtaCheckResult | null>(null);
  const [launchMinimumElapsed, setLaunchMinimumElapsed] = useState(false);
  const [launchTimeout, setLaunchTimeout] = useState(false);
  const [launchBranding, setLaunchBranding] = useState(config.branding);
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
  const launchVisual = launchBranding?.launch.visuals[launchTheme];
  const nativeUpdateStatus = useUpdateStatus();
  const t = useCallback(
    (key: string) => translateMessage(config.localization.messages, key),
    [config.localization.messages],
  );
  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);
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
        if (active) setLaunchBranding(cached.branding);
      },
    );
    void warmBrandingAssets(
      collectBrandingAssets(config),
      remoteBranding.cachePolicy,
    ).then(() => {
      if (!active) return;
      void hydrateCachedBranding({ ...config, branding: remoteBranding }).then(
        (cached) => {
          if (active) setLaunchBranding(cached.branding);
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
    if (!query.isPending && !snapshot.stale) runSilentOtaCheck(config);
  }, [config, query.isPending, runSilentOtaCheck, snapshot.stale]);
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
    if (snapshot.stale) return;
    void registerPushTokenIfAuthorized(config, themePreference).then(
      setNotificationStatus,
    );
  }, [config, snapshot.stale, themePreference]);
  useEffect(
    () =>
      subscribeToUpdateSignals((signal) => {
        if (signal.opened && signal.type) {
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
      snapshot,
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
      snapshot,
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
      <RuntimeContext.Provider value={value}>
        {launchMinimumElapsed && (!query.isPending || launchTimeout) ? (
          children
        ) : (
          <LaunchScreen
            message={launchBranding?.launch.subtitle || t("status.loading")}
            title={launchBranding?.launch.title || t("app.name")}
            backgroundColor={launchVisual?.backgroundColor}
            logo={launchVisual?.logo}
            backgroundImage={launchVisual?.backgroundImage}
            animationType={launchBranding?.launch.animation.type}
            animationDurationMs={launchBranding?.launch.animation.durationMs}
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
          <FoundationThemeProvider config={config} preference={themePreference}>
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
    </FoundationThemeProvider>
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
