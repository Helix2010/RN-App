import type { ExpoConfig, ConfigContext } from "expo/config";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type TenantBuildConfig = {
  slug: string;
  appName: string;
  scheme: string;
  androidPackage: string;
  iosBundleId: string;
  apiBaseUrl: string;
  applicationId: string;
  distributionChannel: "development" | "staging" | "store" | "direct" | "mdm";
  otaChannel: "development" | "staging" | "production";
  version: string;
  androidVersionCode: number;
  iosBuildNumber: string;
  iconBackgroundColor?: string;
  icon: {
    icon: string;
    androidForeground: string;
    androidBackground: string;
    androidMonochrome: string;
  };
};

// 无租户开发构建的应用身份：与 scripts/check-build-profiles.mjs 共用同一份声明（安全评审 N20）
const developmentIdentity = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "tenants", "development-identity.json"),
    "utf8",
  ),
) as { androidPackage: string; iosBundleId: string };

const tenantSlug = process.env.EXPO_PUBLIC_TENANT;
const tenantFile = tenantSlug
  ? resolve(process.cwd(), "tenants", tenantSlug, "tenant.json")
  : null;
if (tenantFile && !existsSync(tenantFile)) {
  throw new Error(`Tenant configuration not found: ${tenantFile}`);
}
const tenant = tenantFile
  ? (JSON.parse(readFileSync(tenantFile, "utf8")) as TenantBuildConfig)
  : null;
if (tenant && !tenant.icon) {
  throw new Error("Tenant configuration must define icon assets");
}

const distributionChannel =
  tenant?.distributionChannel ??
  process.env.EXPO_PUBLIC_DISTRIBUTION_CHANNEL ??
  "development";
const otaChannel =
  tenant?.otaChannel ??
  process.env.EXPO_PUBLIC_OTA_CHANNEL ??
  (distributionChannel === "development" || distributionChannel === "staging"
    ? distributionChannel
    : "production");
// An empty EXPO_UPDATES_URL (e.g. from a local .env file) must behave like
// "unset", otherwise the tenant OTA manifest URL is skipped and release
// builds ship with updates disabled.
const updatesUrl = process.env.EXPO_UPDATES_URL || undefined;
const codeSigningCertificate =
  process.env.EXPO_UPDATES_CODE_SIGNING_CERTIFICATE;
const codeSigningKeyId = process.env.EXPO_UPDATES_CODE_SIGNING_KEY_ID ?? "main";
// 证书路径由 expo-updates 相对项目根解析：拼错的路径会一路沉默到运行时才发现
// "更新没有验签"，在这里当场停下来。
if (
  codeSigningCertificate &&
  !existsSync(resolve(process.cwd(), codeSigningCertificate))
)
  throw new Error(
    `EXPO_UPDATES_CODE_SIGNING_CERTIFICATE points to a missing file: ${codeSigningCertificate}`,
  );
// OTA 真实性门禁（安全评审 N19）。默认关闭：证书体系还没建立——密钥仪式、
// 服务端对最终 manifest 与 directive 签名、自定义 plugin 三件都没到位，现在就
// 强制会把所有发布卡死。开关先落在这里，等证书就位后把默认改成开、再把开关删掉。
// 开着的时候，任何会真正启用 OTA 的非 development 构建缺信任根即构建失败。
const requireOTASigning = /^(1|true|yes|on)$/i.test(
  process.env.EXPO_REQUIRE_OTA_SIGNING ?? "",
);
if (
  requireOTASigning &&
  distributionChannel !== "development" &&
  updatesUrl &&
  !codeSigningCertificate
)
  throw new Error(
    "EXPO_REQUIRE_OTA_SIGNING is on but EXPO_UPDATES_CODE_SIGNING_CERTIFICATE is missing: a non-development build must carry the tenant OTA trust root (security review N19)",
  );
const applicationId =
  tenant?.applicationId ??
  process.env.EXPO_PUBLIC_APPLICATION_ID ??
  "dex-mobile";
const tenantAsset = (name: string, fallback: string): string =>
  tenant ? `./assets/tenants/${tenant.slug}/${name}` : fallback;
const iconAssets = tenant?.icon ?? {
  icon: "icon.png",
  androidForeground: "android-icon-foreground.png",
  androidBackground: "android-icon-background.png",
  androidMonochrome: "android-icon-monochrome.png",
};
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
const appVersion = tenant?.version ?? "0.0.0-dev";
const androidVersionCode = tenant?.androidVersionCode ?? 1;
const iosBuildNumber = tenant?.iosBuildNumber ?? "1";
const buildNumber =
  process.env.EXPO_OS === "ios" ? iosBuildNumber : String(androidVersionCode);
// 图标底色与原生启动图底色共用：冷启动第一帧就是这个纯色，没有 logo。
// logo 只由 JS 启动页画一次（按租户下发的品牌配置），原生层再画一遍就是两张启动图。
const iconBackgroundColor = tenant?.iconBackgroundColor ?? "#E9F0FF";
const apiBaseUrl =
  tenant?.apiBaseUrl ??
  process.env.EXPO_PUBLIC_API_BASE_URL ??
  (distributionChannel === "development" ? "http://localhost:3000" : "");

if (!apiBaseUrl) {
  throw new Error(
    "EXPO_PUBLIC_API_BASE_URL is required outside the development profile",
  );
}
if (distributionChannel !== "development" && !tenant) {
  throw new Error(
    "EXPO_PUBLIC_TENANT is required for non-development builds; use tenants/<slug>/tenant.json",
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

/**
 * 回跳用的 App Link（安全评审 N13）。
 *
 * 自定义 scheme（`anyfun://`）谁都能在自己的 manifest 里声明，装了恶意应用的
 * 机器上，外部钱包批准后的回跳可能落到别人手里。App Link 绑在租户自己的 API
 * 域名上，由服务端的 `/.well-known/assetlinks.json` 决定谁能接管，抢注不了。
 *
 * **只声明一条窄路径**，不要声明整个 host：把 `api.anyfun.win/*` 都交给 App，
 * 浏览器里打开任何一个 API 地址都会被系统拉起应用。
 *
 * http（本地开发）没有 App Link，返回 undefined，回跳退回自定义 scheme。
 */
const APP_LINK_PATH = "/app/wc";
const walletConnectRedirectUrl = apiBaseUrl.startsWith("https://")
  ? `${new URL(apiBaseUrl).origin}${APP_LINK_PATH}`
  : undefined;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: tenant?.appName ?? "AnyFun",
  slug: tenant ? `${tenant.slug}-app` : "anyfun-foundation",
  scheme: tenant?.scheme ?? "anyfun",
  version: appVersion,
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  icon: tenantAsset(iconAssets.icon, "./assets/icon.png"),
  ios: {
    supportsTablet: true,
    // 无租户的开发构建身份：不得与任何生产租户相同（安全评审 N20；check-build-profiles 校验）
    bundleIdentifier: tenant?.iosBundleId ?? developmentIdentity.iosBundleId,
    buildNumber: iosBuildNumber,
  },
  android: {
    package: tenant?.androidPackage ?? developmentIdentity.androidPackage,
    versionCode: androidVersionCode,
    allowBackup: false,
    // Expo 模板 Manifest 自带悬浮窗权限；钱包应用不需要它，且会被安全扫描器标记（安全评审 N16）
    blockedPermissions: ["android.permission.SYSTEM_ALERT_WINDOW"],
    // Keep Android system back dispatch on the legacy bridge so the app-level
    // navigation state can consume root back gestures instead of backgrounding
    // the activity. Native builds must be regenerated after this change.
    predictiveBackGestureEnabled: false,
    adaptiveIcon: {
      backgroundColor: iconBackgroundColor,
      foregroundImage: tenantAsset(
        iconAssets.androidForeground,
        "./assets/android-icon-foreground.png",
      ),
      backgroundImage: tenantAsset(
        iconAssets.androidBackground,
        "./assets/android-icon-background.png",
      ),
      monochromeImage: tenantAsset(
        iconAssets.androidMonochrome,
        "./assets/android-icon-monochrome.png",
      ),
    },
    permissions: [
      "POST_NOTIFICATIONS",
      ...(distributionChannel === "direct" ? ["REQUEST_INSTALL_PACKAGES"] : []),
    ],
    // autoVerify 让系统开机时去拉 assetlinks.json 核验域名归属；核验通过后
    // 这条链接只会打开本应用，不会弹"用什么打开"的选择框
    ...(walletConnectRedirectUrl
      ? {
          intentFilters: [
            {
              action: "VIEW",
              autoVerify: true,
              category: ["BROWSABLE", "DEFAULT"],
              data: [
                {
                  scheme: "https",
                  host: new URL(apiBaseUrl).host,
                  pathPrefix: APP_LINK_PATH,
                },
              ],
            },
          ],
        }
      : {}),
    ...(googleServicesFile ? { googleServicesFile } : {}),
  },
  plugins: [
    "expo-localization",
    "expo-secure-store",
    "expo-notifications",
    // 转出页扫描收款地址二维码（ADR 0010）；权限文案是系统弹窗里用户看到的理由
    [
      "expo-camera",
      {
        cameraPermission:
          "Allow $(PRODUCT_NAME) to use the camera to scan wallet address QR codes.",
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    // 外部钱包的 package visibility 声明：开发包也要，否则本地调不通深链
    "./plugins/with-wallet-deep-links.js",
    // Gradle wrapper 分发包校验和（安全评审 N28）
    "./plugins/with-gradle-distribution-checksum.js",
    // Gradle 依赖校验清单（安全评审 N28）。默认不安装，GRADLE_DEPENDENCY_VERIFICATION=1
    // 才把 gradle/verification-metadata.xml 放进去；关着时确保工程里不残留旧清单
    "./plugins/with-gradle-dependency-verification.js",
    // jitpack 排在 google/mavenCentral 之后，解析不到的坐标都会落到它身上，
    // 而它的内容随作者仓库可变。清单里没有一个组件来自它（安全评审 N28）
    "./plugins/with-pinned-maven-repositories.js",
    // 原生启动图改成纯色：模板默认那张占位图（网格 + 同心圆）不属于任何租户
    [
      "./plugins/with-plain-splash.js",
      { backgroundColor: iconBackgroundColor },
    ],
    ...(distributionChannel === "development"
      ? []
      : [
          "./plugins/with-production-android-optimizations.js",
          // release 签名只来自环境变量注入的生产密钥，缺失即 prebuild 失败（安全评审 N1）
          "./plugins/with-release-signing.js",
        ]),
  ],
  // OTA records are explicitly bound to an APK version. Server and client
  // additionally verify buildNumber so two native builds cannot share an OTA.
  runtimeVersion: appVersion,
  updates: resolvedUpdatesUrl
    ? {
        enabled: true,
        url: resolvedUpdatesUrl,
        // Bootstrap decides whether OTA is enabled for this tenant, so the
        // native side never checks on a normal launch. ON_ERROR_RECOVERY keeps
        // that and adds one exception: when the JS bundle throws during
        // startup, expo-updates fetches the latest update (5 s budget) and
        // relaunches into it, so a bad OTA can be fixed by publishing a good
        // one instead of asking users to reinstall (rev 16 incident, 2026-09-09).
        checkAutomatically: "ON_ERROR_RECOVERY",
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
    // 没有就是没有（本地 http 构建）：WalletConnect 只用自定义 scheme 回跳
    walletConnectRedirectUrl,
    appVersion,
    buildNumber,
  },
});
