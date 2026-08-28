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
import { AppState } from "react-native";
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
  PrimaryButton,
  SecondaryButton,
  Stack,
} from "../design-system";
import { LaunchScreen } from "./launch-screen";

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
};

const RuntimeContext = createContext<RuntimeValue | null>(null);

function systemLocale(): SupportedLocale {
  return getLocales()[0]?.languageCode === "en" ? "en-US" : "zh-CN";
}

export function FoundationRuntimeProvider({ children }: PropsWithChildren) {
  const localePreference = usePreferencesStore((state) => state.locale);
  const themePreference = usePreferencesStore((state) => state.theme);
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
  const [dismissedUpdateId, setDismissedUpdateId] = useState<string | null>(
    null,
  );
  const [launchMinimumElapsed, setLaunchMinimumElapsed] = useState(false);
  const [launchTimeout, setLaunchTimeout] = useState(false);
  const nativeUpdateStatus = useUpdateStatus();
  const t = useCallback(
    (key: string) => translateMessage(config.localization.messages, key),
    [config.localization.messages],
  );
  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);
  useEffect(() => {
    const minimumTimer = setTimeout(() => setLaunchMinimumElapsed(true), 700);
    const timeoutTimer = setTimeout(() => setLaunchTimeout(true), 1_800);
    return () => {
      clearTimeout(minimumTimer);
      clearTimeout(timeoutTimer);
    };
  }, []);
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
  const pendingOta = useMemo(
    () =>
      otaResult?.status === "ready"
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
    if (!pendingOta) return;
    setOtaResult({ ...pendingOta, status: "applying" });
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
    ],
  );

  return (
    <FoundationThemeProvider config={config} preference={themePreference}>
      <RuntimeContext.Provider value={value}>
        {launchMinimumElapsed && (!query.isPending || launchTimeout) ? (
          children
        ) : (
          <LaunchScreen message={t("status.loading")} />
        )}
        {pendingOta?.metadata.applyStrategy === "immediate" &&
        dismissedUpdateId !== pendingOta.metadata.updateId ? (
          <Stack
            position="absolute"
            top={0}
            right={0}
            bottom={0}
            left={0}
            zIndex={100}
            justifyContent="center"
            padding="$4"
            backgroundColor="$backdrop"
            accessibilityRole="alert"
          >
            <Card
              width="100%"
              maxWidth={460}
              alignSelf="center"
              borderColor="$warning"
              backgroundColor="$surface"
            >
              <Stack gap="$2">
                <Body fontWeight="800">{t("update.otaImmediateTitle")}</Body>
                <Body>{t("update.otaImmediateConfirm")}</Body>
                <PrimaryButton onPress={() => void applyPendingOta()}>
                  {t("update.applyImmediate")}
                </PrimaryButton>
                <SecondaryButton
                  onPress={() =>
                    setDismissedUpdateId(
                      pendingOta.metadata.updateId ?? "pending",
                    )
                  }
                >
                  {t("action.later")}
                </SecondaryButton>
              </Stack>
            </Card>
          </Stack>
        ) : null}
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
