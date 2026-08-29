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
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
const appVersion = "1.1.7";
const androidVersionCode = 11;
const iosBuildNumber = "3";
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
  name: "AnyFun",
  slug: "anyfun-foundation",
  scheme: "anyfun",
  version: appVersion,
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.anyfun.foundation",
    buildNumber: iosBuildNumber,
  },
  android: {
    package: "com.anyfun.foundation",
    versionCode: androidVersionCode,
    predictiveBackGestureEnabled: true,
    adaptiveIcon: {
      backgroundColor: "#E9F0FF",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    permissions: [
      "POST_NOTIFICATIONS",
      ...(distributionChannel === "direct" ? ["REQUEST_INSTALL_PACKAGES"] : []),
    ],
    ...(googleServicesFile ? { googleServicesFile } : {}),
  },
  plugins: ["expo-localization", "expo-secure-store", "expo-notifications"],
  runtimeVersion: { policy: "fingerprint" },
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
    buildNumber:
      process.env.EXPO_OS === "ios"
        ? iosBuildNumber
        : String(androidVersionCode),
  },
});
