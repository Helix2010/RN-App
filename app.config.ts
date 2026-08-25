import type { ExpoConfig, ConfigContext } from "expo/config";

const distributionChannel =
  process.env.EXPO_PUBLIC_DISTRIBUTION_CHANNEL ?? "development";
const updatesUrl = process.env.EXPO_UPDATES_URL;
const tenantSlug = process.env.EXPO_PUBLIC_TENANT_SLUG ?? "default";
const applicationId = process.env.EXPO_PUBLIC_APPLICATION_ID ?? "dex-mobile";
const apiBaseUrl =
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  (distributionChannel === "development" ? "http://localhost:3000" : "");

if (!apiBaseUrl) {
  throw new Error(
    "EXPO_PUBLIC_API_BASE_URL is required outside the development profile",
  );
}
if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(tenantSlug)) {
  throw new Error("EXPO_PUBLIC_TENANT_SLUG must be a valid tenant slug");
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

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "RN Foundation",
  slug: "rn-foundation",
  scheme: "rnfoundation",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.example.rnfoundation",
    buildNumber: "1",
  },
  android: {
    package: "com.example.rnfoundation",
    versionCode: 1,
    predictiveBackGestureEnabled: true,
    adaptiveIcon: {
      backgroundColor: "#E9F0FF",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    permissions:
      distributionChannel === "direct" ? ["REQUEST_INSTALL_PACKAGES"] : [],
  },
  plugins: ["expo-localization"],
  runtimeVersion: { policy: "fingerprint" },
  updates: updatesUrl
    ? {
        enabled: true,
        url: updatesUrl,
        checkAutomatically: "ON_LOAD",
        fallbackToCacheTimeout: 0,
      }
    : { enabled: false },
  extra: {
    apiBaseUrl,
    distributionChannel,
    tenantSlug,
    applicationId,
  },
});
