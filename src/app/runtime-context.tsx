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
import { checkAndDownloadOta } from "../core/updates/update-service";
import { FoundationThemeProvider } from "../design-system";
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
  const otaAttemptedRef = useRef<string | null>(null);
  const [launchMinimumElapsed, setLaunchMinimumElapsed] = useState(false);
  const [launchTimeout, setLaunchTimeout] = useState(false);
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
  useEffect(() => {
    const interval =
      Math.max(300, config.localization.refreshIntervalSeconds ?? 21600) * 1000;
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void query.refetch();
    }, interval);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void query.refetch();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [config.localization.refreshIntervalSeconds, query]);
  useEffect(() => {
    if (query.isPending || snapshot.stale) return;
    const key = [
      config.configVersion,
      config.features.otaEnabled,
      config.update.ota.enabled,
      config.update.ota.channel,
      config.update.ota.runtimeVersion,
    ].join(":");
    if (otaAttemptedRef.current === key) return;
    otaAttemptedRef.current = key;
    // OTA is deliberately a background, non-blocking operation. The native
    // module uses checkAutomatically=NEVER, so this is the only automatic
    // check and it always observes the tenant Bootstrap policy.
    void checkAndDownloadOta(config);
  }, [config, query.isPending, snapshot.stale]);
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
    }),
    [
      config,
      localePreference,
      query.isFetching,
      query.isPending,
      refresh,
      setLocale,
      setTheme,
      snapshot,
      t,
      themePreference,
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
