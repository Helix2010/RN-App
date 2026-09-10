import { appRuntime } from "../network/api-client";
import type {
  BootstrapConfig,
  SemanticPalette,
  SupportedLocale,
} from "./bootstrap.schema";
import { builtinMessages } from "./builtin-messages";

const light: SemanticPalette = {
  primary: "#F0B90B",
  onPrimary: "#181A20",
  background: "#F5F5F5",
  surface: "#FFFFFF",
  surfaceVariant: "#F0F1F2",
  text: "#1E2329",
  textMuted: "#707A8A",
  border: "#EAECEF",
  success: "#0ECB81",
  warning: "#D0980B",
  danger: "#F6465D",
  info: "#3861FB",
  pricePositive: "#0ECB81",
  priceNegative: "#F6465D",
  risk: "#D0980B",
  focus: "#FCD535",
  backdrop: "rgba(24,26,32,0.56)",
};

const dark: SemanticPalette = {
  primary: "#F0B90B",
  onPrimary: "#181A20",
  background: "#0B0E11",
  surface: "#181A20",
  surfaceVariant: "#23262D",
  text: "#EAECEF",
  textMuted: "#848E9C",
  border: "#2B3139",
  success: "#0ECB81",
  warning: "#F0B90B",
  danger: "#F6465D",
  info: "#4A7DFF",
  pricePositive: "#0ECB81",
  priceNegative: "#F6465D",
  risk: "#F0B90B",
  focus: "#FCD535",
  backdrop: "rgba(0,0,0,0.72)",
};

export function createFallbackConfig(locale: SupportedLocale): BootstrapConfig {
  return {
    schemaVersion: 1,
    configVersion: "embedded-1",
    generatedAt: "2026-08-21T00:00:00.000Z",
    ttlSeconds: 300,
    requestId: "offline",
    localization: {
      selectedLocale: locale,
      refreshIntervalSeconds: 21_600,
      fallbackLocale: "zh-CN",
      supportedLocales: ["zh-CN", "en-US"],
      localeCatalog: [
        { code: "zh-CN", label: "简体中文", nativeName: "中文" },
        { code: "en-US", label: "English", nativeName: "English" },
      ],
      messagesVersion: "embedded-1",
      messages: builtinMessages(locale),
    },
    theme: {
      defaultMode: "system",
      allowUserOverride: true,
      paletteVersion: "embedded-trading-1",
      light,
      dark,
    },
    modules: { predict: true, dex: true },
    // 内置配置里没有租户，也就没有外部服务的关联
    services: {},
    // 内置配置里没有租户，也就没有链、没有目录：钱包界面在收到下发前是空态
    wallet: {
      walletConnectProjectId: "",
      onchainSends: false,
      networks: [],
      tokens: [],
    },
    branding: {
      schemaVersion: 1,
      version: 1,
      enabled: true,
      selectedLocale: locale,
      fallbackLocale: "zh-CN",
      launch: {
        enabled: true,
        minDisplayMs: 700,
        animation: { type: "fade_scale", durationMs: 360 },
        title: locale === "en-US" ? "AnyFun" : "AnyFun",
        subtitle:
          locale === "en-US" ? "Syncing app configuration" : "正在同步应用配置",
        visuals: {
          light: { backgroundColor: light.background },
          dark: { backgroundColor: dark.background },
        },
      },
      cachePolicy: {
        maxBytes: 20 * 1024 * 1024,
        keepVersions: 2,
        staleAfterSeconds: 7 * 24 * 60 * 60,
      },
    },
    features: {
      updateCenter: true,
      otaEnabled: false,
      directUpdateEnabled: appRuntime.platform === "android",
      diagnosticsEnabled: true,
    },
    app: {
      version: appRuntime.version,
      buildNumber: appRuntime.buildNumber,
      platform: appRuntime.platform,
      distribution:
        appRuntime.distributionChannel as BootstrapConfig["app"]["distribution"],
      runtimeVersion: appRuntime.runtimeVersion,
    },
    update: {
      decision: "none",
      minSupportedVersion: appRuntime.version,
      latestVersion: appRuntime.version,
      releaseNotes: [],
      ota: {
        enabled: false,
        channel: "embedded",
        runtimeVersion: appRuntime.runtimeVersion,
        applyStrategy: "next_launch",
        revision: null,
        updateId: null,
        baseReleaseId: null,
        releaseNotes: [],
      },
      full: {
        channel: "development",
        actionUrl: null,
        releaseId: null,
        sha256: null,
        size: null,
      },
    },
    support: {
      diagnosticId: "offline",
      statusPageUrl: "https://status.example.com",
    },
  };
}
