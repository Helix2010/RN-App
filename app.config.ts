import type { ExpoConfig, ConfigContext } from "expo/config";

const distributionChannel =
  process.env.EXPO_PUBLIC_DISTRIBUTION_CHANNEL ?? "development";
const updatesUrl = process.env.EXPO_UPDATES_URL;
const applicationId = process.env.EXPO_PUBLIC_APPLICATION_ID ?? "dex-mobile";
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

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "AnyFun",
  slug: "anyfun-foundation",
  scheme: "anyfun",
  version: "1.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: "./assets/icon.png",
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.anyfun.foundation",
    buildNumber: "2",
  },
  android: {
    package: "com.anyfun.foundation",
    versionCode: 4,
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
    applicationId,
  },
});
