import type { ExpoConfig, ConfigContext } from "expo/config";

const distributionChannel =
  process.env.EXPO_PUBLIC_DISTRIBUTION_CHANNEL ?? "development";
const otaChannel =
  process.env.EXPO_PUBLIC_OTA_CHANNEL ??
  (distributionChannel === "development" || distributionChannel === "staging"
    ? distributionChannel
    : "production");
const updatesUrl = process.env.EXPO_UPDATES_URL;
const codeSigningCertificate =
  process.env.EXPO_UPDATES_CODE_SIGNING_CERTIFICATE;
const codeSigningKeyId = process.env.EXPO_UPDATES_CODE_SIGNING_KEY_ID ?? "main";
const applicationId = process.env.EXPO_PUBLIC_APPLICATION_ID ?? "dex-mobile";
/**
 * 租户工厂：`node scripts/tenant.mjs <slug> --env-file --pull-branding` 写入 EXPO_PUBLIC_TENANT_* 与
 * assets/tenants/<slug>/ 图标；这里只读 env，不碰文件系统（app.config 与 RN 共享 tsconfig）。
 */
const tenantSlug = process.env.EXPO_PUBLIC_TENANT;
const tenant = tenantSlug
  ? {
      slug: tenantSlug,
      appName: process.env.EXPO_PUBLIC_TENANT_NAME ?? "AnyFun",
      scheme: process.env.EXPO_PUBLIC_TENANT_SCHEME ?? tenantSlug,
      androidPackage:
        process.env.EXPO_PUBLIC_TENANT_ANDROID_PACKAGE ??
        `com.${tenantSlug}.app`,
      iosBundleId:
        process.env.EXPO_PUBLIC_TENANT_IOS_BUNDLE_ID ?? `com.${tenantSlug}.app`,
      iconBackgroundColor: process.env.EXPO_PUBLIC_TENANT_ICON_BG,
    }
  : null;
const tenantAsset = (name: string, fallback: string): string =>
  tenant ? `./assets/tenants/${tenant.slug}/${name}` : fallback;
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
const appVersion = "1.2.0";
const androidVersionCode = 14;
const iosBuildNumber = "6";
const buildNumber =
  process.env.EXPO_OS === "ios" ? iosBuildNumber : String(androidVersionCode);
const apiBaseUrl =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  (distributionChannel === "development" ? "http://localhost:3000" : "");

if (!apiBaseUrl) {
  throw new Error(
    "EXPO_PUBLIC_API_BASE_URL is required outside the development profile",
  );
}
if (!/^[a-z0-9][a-z0-9_-]{1,119}$/.test(applicationId)) {
  throw new Error("EXPO_PUBLIC_APPLICATION_ID must be a valid application id");
}
if (
  distributionChannel !== "development" &&
  (!apiBaseUrl.startsWith("https://") ||
    apiBaseUrl.includes("localhost") ||
    apiBaseUrl.includes("127.0.0.1"))
) {
  throw new Error(
    "Non-development profiles require a non-local HTTPS API base URL",
  );
}

const resolvedUpdatesUrl =
  updatesUrl ??
  (apiBaseUrl.startsWith("https://")
    ? `${apiBaseUrl}/v1/ota/manifest`
    : undefined);
if (resolvedUpdatesUrl) {
  const apiOrigin = new URL(apiBaseUrl).origin;
  const updateOrigin = new URL(resolvedUpdatesUrl).origin;
  if (apiOrigin !== updateOrigin) {
    throw new Error(
      "EXPO_UPDATES_URL must use the same tenant origin as EXPO_PUBLIC_API_BASE_URL",
    );
  }
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: tenant?.appName ?? "AnyFun",
  slug: tenant ? `${tenant.slug}-app` : "anyfun-foundation",
  scheme: tenant?.scheme ?? "anyfun",
  version: appVersion,
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: tenantAsset("icon.png", "./assets/icon.png"),
  ios: {
    supportsTablet: true,
    bundleIdentifier: tenant?.iosBundleId ?? "com.anyfun.foundation",
    buildNumber: iosBuildNumber,
  },
  android: {
    package: tenant?.androidPackage ?? "com.anyfun.foundation",
    versionCode: androidVersionCode,
    allowBackup: false,
    // Keep Android system back dispatch on the legacy bridge so the app-level
    // navigation state can consume root back gestures instead of backgrounding
    // the activity. Native builds must be regenerated after this change.
    predictiveBackGestureEnabled: true,
    adaptiveIcon: {
      backgroundColor: tenant?.iconBackgroundColor ?? "#E9F0FF",
      foregroundImage: tenantAsset(
        "android-icon-foreground.png",
        "./assets/android-icon-foreground.png",
      ),
      backgroundImage: tenantAsset(
        "android-icon-background.png",
        "./assets/android-icon-background.png",
      ),
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    permissions: [
      "POST_NOTIFICATIONS",
      ...(distributionChannel === "direct" ? ["REQUEST_INSTALL_PACKAGES"] : []),
    ],
    ...(googleServicesFile ? { googleServicesFile } : {}),
  },
  plugins: [
    "expo-localization",
    "expo-secure-store",
    "expo-notifications",
    ...(distributionChannel === "development"
      ? []
      : ["./plugins/with-production-android-optimizations.js"]),
  ],
  // OTA records are explicitly bound to an APK version. Server and client
  // additionally verify buildNumber so two native builds cannot share an OTA.
  runtimeVersion: appVersion,
  updates: resolvedUpdatesUrl
    ? {
        enabled: true,
        url: resolvedUpdatesUrl,
        // Bootstrap decides whether OTA is enabled for this tenant. Native
        // startup checks would run before Bootstrap and bypass that policy.
        checkAutomatically: "NEVER",
        fallbackToCacheTimeout: 0,
        requestHeaders: {
          "expo-channel-name": otaChannel,
          "x-application-id": applicationId,
          "x-app-version": appVersion,
          "x-build-number": buildNumber,
        },
        ...(codeSigningCertificate && distributionChannel !== "development"
          ? {
              codeSigningCertificate,
              codeSigningMetadata: {
                alg: "rsa-v1_5-sha256" as const,
                keyid: codeSigningKeyId,
              },
            }
          : {}),
      }
    : { enabled: false },
  extra: {
    apiBaseUrl,
    distributionChannel,
    otaChannel,
    applicationId,
    nativePushConfigured: Boolean(googleServicesFile),
    appVersion,
    buildNumber,
  },
});
