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
import {
  loadCachedBootstrap,
  type BootstrapSnapshot,
} from "../core/config/bootstrap-repository";
import type {
  BootstrapConfig,
  SupportedLocale,
} from "../core/config/bootstrap.schema";
import { createFallbackConfig } from "../core/config/fallback-config";
import { translateMessage } from "../core/config/localization";
import { bootstrapQueryFn, useBootstrap } from "../core/config/use-bootstrap";
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
import { resolveUpdatePlan } from "../core/updates/update-coordinator";
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
  resolveBrandingVisual,
  warmBrandingAssets,
} from "../core/config/branding-assets";

/** 没有品牌配置的租户，启动页至少停留这么久，避免一闪而过。 */
const LAUNCH_MIN_DISPLAY_MS = 700;

type LaunchBranding = NonNullable<BootstrapConfig["branding"]>;

function launchBrandingOf(config: BootstrapConfig): LaunchBranding | null {
  return config.branding?.enabled && config.branding.launch.enabled
    ? config.branding
    : null;
}

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
  checkForUpdates: () => Promise<UpdateCheckResult>;
  dismissUpdatePrompt: () => void;
  manualUpdatePromptVersion: string | null;
  otaResult: OtaCheckResult | null;
  applyPendingOta: () => Promise<void>;
  notificationStatus: "idle" | "registered" | "denied" | "unavailable";
  enableUpdateNotifications: () => Promise<void>;
  notificationIntent: { type: string; eventId: string } | null;
};

export type UpdateCheckResult =
  | { kind: "none"; snapshot: BootstrapSnapshot }
  | { kind: "full"; snapshot: BootstrapSnapshot }
  | { kind: "ota"; snapshot: BootstrapSnapshot; result: OtaCheckResult }
  | { kind: "error"; error: Error };

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
  // 拿到远程下发之前 config 是内置配置：它只用来渲染启动门禁（启动页 / 重试屏 /
  // 强制 OTA 弹层）。业务界面（children）只在 entered 之后挂载，永远不会跑在它上面。
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
  const updateCheckRef = useRef<Promise<UpdateCheckResult> | null>(null);
  const [otaResult, setOtaResult] = useState<OtaCheckResult | null>(null);
  const [manualUpdatePromptVersion, setManualUpdatePromptVersion] = useState<
    string | null
  >(null);
  const [launchMinimumElapsed, setLaunchMinimumElapsed] = useState(false);
  // 上次成功的 bootstrap（读本地缓存）：undefined = 还没读完；null = 没有缓存
  const [cachedLaunchConfig, setCachedLaunchConfig] = useState<
    BootstrapConfig | null | undefined
  >(undefined);
  // 进入过一次就不再回到启动页：运行中的配置刷新失败不该把用户踢回门禁
  const [entered, setEntered] = useState(false);
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
  /**
   * 本次启动用哪一版品牌视觉，**严格按服务端配置、决定一次就不再换**：
   * 有上次缓存的 bootstrap 就用缓存里那一版（图片已在本地，一次画成），服务端这次下发
   * 了新版本也只在后台预热、留给下一次启动；没有缓存（首次安装）就用本次下发的那版。
   * 中途换版本，logo 会随着"缓存 → 远程 → 预热完成"换 URI，用户看到的就是启动图加载
   * 了好几遍。undefined 表示还不知道（缓存没读完 / 首次安装还没拿到下发）。
   */
  const activeBranding: LaunchBranding | null | undefined =
    cachedLaunchConfig === undefined
      ? undefined
      : cachedLaunchConfig !== null
        ? launchBrandingOf(cachedLaunchConfig)
        : snapshot
          ? launchBrandingOf(snapshot.config)
          : undefined;
  const launchPending = activeBranding === undefined;
  const launchVisual = activeBranding
    ? resolveBrandingVisual(activeBranding.launch.visuals, launchTheme)
    : undefined;
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
            queryFn: ({ signal }) => bootstrapQueryFn(targetLocale, signal),
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
  useEffect(() => {
    let active = true;
    void loadCachedBootstrap(locale).then((cached) => {
      if (active) setCachedLaunchConfig((known) => known ?? cached);
    });
    return () => {
      active = false;
    };
  }, [locale]);
  const refresh = useCallback(async (): Promise<BootstrapSnapshot> => {
    const result = await query.refetch();
    // refetch 失败时 React Query 会保留上一份 data；那不是"刷新成功"
    if (result.isError)
      throw result.error ?? new Error("Remote Bootstrap is unavailable");
    if (result.data) return result.data;
    throw new Error("Remote Bootstrap is unavailable");
  }, [query]);
  const dismissUpdatePrompt = useCallback(() => {
    setManualUpdatePromptVersion(null);
  }, []);
  const checkForUpdates = useCallback((): Promise<UpdateCheckResult> => {
    if (updateCheckRef.current) return updateCheckRef.current;
    const task = (async (): Promise<UpdateCheckResult> => {
      try {
        const refreshed = await refresh();
        if (refreshed.source !== "remote" || refreshed.stale) {
          return {
            kind: "error",
            error: new Error("Remote configuration is stale"),
          };
        }
        const candidate = refreshed.config;
        const plan = resolveUpdatePlan(candidate);
        if (plan === "full") {
          setManualUpdatePromptVersion(candidate.update.latestVersion);
          return { kind: "full", snapshot: refreshed };
        }
        if (plan === "ota") {
          const result = await checkAndDownloadOta(candidate);
          setOtaResult(result);
          if (result.status === "ready" || result.status === "rollback") {
            return { kind: "ota", snapshot: refreshed, result };
          }
          if (result.status === "error") {
            return { kind: "error", error: new Error("OTA check failed") };
          }
          return { kind: "none", snapshot: refreshed };
        }
        return { kind: "none", snapshot: refreshed };
      } catch (error) {
        return {
          kind: "error",
          error:
            error instanceof Error ? error : new Error("Update check failed"),
        };
      }
    })();
    updateCheckRef.current = task;
    void task.finally(() => {
      if (updateCheckRef.current === task) updateCheckRef.current = null;
    });
    return task;
  }, [refresh]);
  // 最短停留时间按冻结的那版品牌配置；没有品牌配置的租户按平台常量
  const minimumMs =
    activeBranding?.launch.minDisplayMs ?? LAUNCH_MIN_DISPLAY_MS;
  useEffect(() => {
    if (launchPending) return;
    const timer = setTimeout(() => setLaunchMinimumElapsed(true), minimumMs);
    return () => clearTimeout(timer);
  }, [launchPending, minimumMs]);
  // 本次下发的品牌资源在后台下载、校验并缓存，给**下一次**启动用；不碰当前启动页
  useEffect(() => {
    if (!snapshot) return;
    const remoteBranding = launchBrandingOf(snapshot.config);
    if (!remoteBranding) return;
    void warmBrandingAssets(
      collectBrandingAssets(snapshot.config),
      remoteBranding.cachePolicy,
    );
  }, [snapshot]);
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
  // 钱包参数（WalletConnect projectId / 链集合 / 代币目录）由服务端按租户下发；
  // 应用后要让连接器列表重新读一次，否则外部钱包会一直停在"未启用"；
  // 真链上的代币列表来自目录，目录变了余额列表也要重读
  // 钱包运行时配置本身在 bootstrapQueryFn 里随数据一起应用；这里只让依赖它的查询重读
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: ["wallet-connectors"] });
    void queryClient.invalidateQueries({ queryKey: ["wallet-balances"] });
  }, [config.wallet, queryClient]);
  // 放行条件：本次拿到了远程下发（不是内置配置）且最短停留已到。没有超时放行：
  // 数据没下来就不进业务页，失败走重试屏。进入过就锁住，后续刷新失败不回门禁
  const deliveryReady =
    snapshot !== undefined && snapshot.source === "remote" && !snapshot.stale;
  if (!entered && deliveryReady && launchMinimumElapsed) setEntered(true);
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
          if (result.data && !result.data.stale) {
            runSilentOtaCheck(result.data.config);
            if (
              signal.type === "app_update_available" &&
              result.data.config.update.decision !== "none" &&
              result.data.config.update.full.actionUrl
            ) {
              setManualUpdatePromptVersion(
                result.data.config.update.latestVersion,
              );
            }
          }
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
      checkForUpdates,
      dismissUpdatePrompt,
      manualUpdatePromptVersion,
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
      checkForUpdates,
      dismissUpdatePrompt,
      manualUpdatePromptVersion,
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
      <RuntimeContext.Provider value={value}>
        {entered ? (
          children
        ) : query.isError && !snapshot ? (
          <BootstrapUnavailableScreen
            locale={locale}
            retrying={query.isFetching}
            onRetry={() => void query.refetch()}
          />
        ) : (
          // 整个启动过程只有这一个实例、同一个树位置：换分支重挂载会让 logo 再淡入一次
          <LaunchScreen
            pending={launchPending}
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
