import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { NavigationContainer } from "@react-navigation/native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react-native";
import type { ReactElement, ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { RuntimeContext, type RuntimeValue } from "../app/runtime-context";
import { createFallbackConfig } from "../core/config/fallback-config";
import type {
  BootstrapConfig,
  SupportedLocale,
} from "../core/config/bootstrap.schema";
import {
  GatewayProvider,
  type Gateways,
} from "../core/gateways/gateway-context";
import { usePreferencesStore } from "../core/preferences/preferences-store";
import { memoryStorage } from "../core/gateways/types";
import { translateMessage } from "../core/config/localization";
import { FoundationThemeProvider } from "../design-system";
import { MockAssetsGateway } from "../features/assets/api/mock-assets-gateway";
import { MockDexGateway } from "../features/dex/api/mock-dex-gateway";
import { MockPredictGateway } from "../features/predict/api/mock-predict-gateway";
import { MockSessionGateway } from "../features/session/api/mock-session-gateway";
import { MockWalletGateway } from "../features/wallet/api/mock-wallet-gateway";

export type HarnessOptions = {
  /** 模块开关：验证"仅 Predict / 仅 DEX / 双开"三种配置下的分支 */
  modules?: Partial<BootstrapConfig["modules"]>;
  locale?: SupportedLocale;
  /** 覆盖部分网关（默认全套内存 Mock，互相隔离） */
  gateways?: Partial<Gateways>;
  /** 覆盖运行时字段（如 update.decision、notificationStatus） */
  runtime?: Partial<RuntimeValue>;
  config?: (config: BootstrapConfig) => BootstrapConfig;
};

/** 每次调用都建一套独立的内存 Mock，测试之间不共享状态。 */
export function createTestGateways(overrides?: Partial<Gateways>): Gateways {
  const storage = memoryStorage();
  const wallet = new MockWalletGateway(storage);
  const predict = new MockPredictGateway(storage);
  return {
    session: new MockSessionGateway(storage),
    wallet,
    predict,
    dex: new MockDexGateway(storage, wallet),
    assets: new MockAssetsGateway(wallet, predict),
    mode: "mock",
    ...overrides,
  };
}

function buildRuntime(options: HarnessOptions): RuntimeValue {
  const locale = options.locale ?? "zh-CN";
  const base = createFallbackConfig(locale);
  const withModules: BootstrapConfig = {
    ...base,
    modules: { ...base.modules, ...options.modules },
  };
  const config = options.config ? options.config(withModules) : withModules;
  return {
    config,
    snapshot: { config, source: "fallback", stale: false },
    // 从真实的偏好 store 读，测试可以先 setState 再渲染来驱动分支
    localePreference: usePreferencesStore.getState().locale,
    themePreference: usePreferencesStore.getState().theme,
    setLocale: async () => {},
    setTheme: () => {},
    t: (key: string) => translateMessage(config.localization.messages, key),
    isInitialLoading: false,
    isRefreshing: false,
    refresh: async () => ({ config, source: "fallback", stale: false }),
    checkForUpdates: async () => ({
      kind: "none",
      snapshot: { config, source: "fallback", stale: false },
    }),
    dismissUpdatePrompt: () => {},
    manualUpdatePromptVersion: null,
    otaResult: null,
    applyPendingOta: async () => {},
    notificationStatus: "registered",
    enableUpdateNotifications: async () => {},
    notificationIntent: null,
    ...options.runtime,
  };
}

/**
 * 渲染业务组件所需的完整 Provider 栈（主题 / 运行时 / Query / 网关 / sheet / 导航）。
 * 查询用 RNTL 的 `screen`：
 * `await renderWithProviders(<AssetsScreen … />, { modules: { dex: false } });`
 * `expect(screen.getByText("资产")).toBeTruthy();`
 *
 * 注意：`@gorhom/bottom-sheet` 在测试里被官方 mock 替换，sheet 内容会随页面一起渲染，
 * 因此同名文案可能出现多次，断言用 `getAllByText`。
 */
export async function renderWithProviders(
  ui: ReactElement,
  options: HarnessOptions & Omit<RenderOptions, "wrapper"> = {},
) {
  const { modules, locale, gateways, runtime, config, ...renderOptions } =
    options;
  const value = buildRuntime({ modules, locale, runtime, config });
  const resolved = createTestGateways(gateways);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <QueryClientProvider client={queryClient}>
          <RuntimeContext.Provider value={value}>
            <FoundationThemeProvider config={value.config} preference="light">
              <GatewayProvider gateways={resolved}>
                <BottomSheetModalProvider>
                  <NavigationContainer>{children}</NavigationContainer>
                </BottomSheetModalProvider>
              </GatewayProvider>
            </FoundationThemeProvider>
          </RuntimeContext.Provider>
        </QueryClientProvider>
      </SafeAreaProvider>
    );
  }

  // RNTL 14 + React 19 的 render 是异步的，必须 await 后再用 `screen` 查询
  await render(ui, { wrapper: Wrapper, ...renderOptions });
  return { gateways: resolved, queryClient, runtime: value };
}

/** 测试里常用：把导航 prop 伪造成 jest.fn，断言跳转目标。 */
export function fakeNavigation<T extends object = object>(overrides?: T) {
  return {
    navigate: jest.fn(),
    goBack: jest.fn(),
    popToTop: jest.fn(),
    push: jest.fn(),
    setOptions: jest.fn(),
    addListener: jest.fn(() => jest.fn()),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** 让这套网关进入"已登录"状态（走真实的 connect → challenge → sign → verify 链路）。 */
export async function signIn(
  gateways: Gateways,
  connector: "metamask" | "embedded" = "metamask",
) {
  const account = await gateways.wallet.connect(connector);
  const request = {
    address: account.address,
    connector,
    chains: account.chains,
    domain: "test.anyfun.win",
  };
  const challenge = await gateways.session.challenge(request);
  const signature = await gateways.wallet.signMessage(
    account.address,
    challenge.message,
  );
  return gateways.session.verify(request, challenge, signature);
}
