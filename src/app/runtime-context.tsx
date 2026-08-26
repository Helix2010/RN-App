import { getLocales } from "expo-localization";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
import { FoundationThemeProvider } from "../design-system";

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
  const t = useCallback(
    (key: string) => translateMessage(config.localization.messages, key),
    [config.localization.messages],
  );
  const refresh = useCallback(async () => {
    await query.refetch();
  }, [query]);
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
        {children}
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
