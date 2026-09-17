import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 租户目录。`RN_TENANTS_ROOT` 只在 Jest 子进程（`JEST_WORKER_ID` 存在）里生效，
 * 让脚本测试用临时目录里的租户夹具，不往仓库 tenants/ 写文件；构建永远读仓库内的 tenants/。
 */
export function tenantsRoot() {
  const override = process.env.RN_TENANTS_ROOT;
  if (override && process.env.JEST_WORKER_ID) return resolve(override);
  return resolve(root, "tenants");
}

/** 无租户开发构建的应用身份：与 app.config.ts 共用同一份声明，不得等于任何生产租户。 */
export function readDevelopmentIdentity() {
  const file = resolve(root, "tenants", "development-identity.json");
  const identity = JSON.parse(readFileSync(file, "utf8"));
  for (const key of ["androidPackage", "iosBundleId"]) {
    if (typeof identity[key] !== "string" || !identity[key].endsWith(".dev"))
      throw new Error(
        `development-identity.json ${key} must be a *.dev identity`,
      );
  }
  return identity;
}

export function readTenantConfig(slug) {
  if (!slug) throw new Error("EXPO_PUBLIC_TENANT is required");
  const file = resolve(tenantsRoot(), slug, "tenant.json");
  if (!existsSync(file))
    throw new Error(`Tenant configuration not found: ${file}`);
  const config = JSON.parse(readFileSync(file, "utf8"));
  for (const key of [
    "slug",
    "appName",
    "scheme",
    "androidPackage",
    "iosBundleId",
    "apiBaseUrl",
    "applicationId",
    "distributionChannel",
    "otaChannel",
    "version",
    "androidVersionCode",
    "iosBuildNumber",
  ]) {
    if (
      config[key] === undefined ||
      config[key] === null ||
      config[key] === ""
    ) {
      throw new Error(`tenant.json missing ${key}`);
    }
  }
  // iOS build 号：Info.plist 的 CFBundleVersion，Apple 要求同一个版本里严格递增，
  // 而且**必须是数字串**——写成 "9.1" 或 "build9" 时上传会被 App Store Connect
  // 在处理阶段退回，那时包已经打完、传完，反馈来得非常晚
  if (!/^[1-9]\d*$/.test(String(config.iosBuildNumber))) {
    throw new Error(
      `tenant.json iosBuildNumber must be a positive integer string, received ${JSON.stringify(config.iosBuildNumber)}`,
    );
  }
  // Apple 开发者团队号：只有 iOS 构建需要，所以可以不填；填了就必须是那 10 位。
  // 它和 signerSha256 一样是公开的身份指纹，不是秘密
  if (
    config.appleTeamId !== undefined &&
    (typeof config.appleTeamId !== "string" ||
      !/^[A-Z0-9]{10}$/.test(config.appleTeamId))
  ) {
    throw new Error(
      "tenant.json appleTeamId must be the 10-character Apple Developer Team ID",
    );
  }
  // 登记的签名证书指纹（安全评审 N1）：只给 `pnpm android:verify` 核对签名闸产出的包用，构建不需要它；这里只校验格式
  if (
    config.signerSha256 !== undefined &&
    (typeof config.signerSha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(config.signerSha256))
  ) {
    throw new Error(
      "tenant.json signerSha256 must be 64 lowercase hex characters (apksigner verify --print-certs)",
    );
  }
  const icon = config.icon;
  for (const key of [
    "icon",
    "androidForeground",
    "androidBackground",
    "androidMonochrome",
  ]) {
    if (
      !icon ||
      typeof icon[key] !== "string" ||
      icon[key] === "" ||
      icon[key].startsWith("/") ||
      icon[key].split("/").includes("..")
    ) {
      throw new Error(`tenant.json missing icon.${key}`);
    }
  }
  return config;
}

export function tenantEnvironment(config) {
  return {
    EXPO_PUBLIC_TENANT: config.slug,
    EXPO_PUBLIC_TENANT_NAME: config.appName,
    EXPO_PUBLIC_TENANT_SCHEME: config.scheme,
    EXPO_PUBLIC_TENANT_ANDROID_PACKAGE: config.androidPackage,
    EXPO_PUBLIC_TENANT_IOS_BUNDLE_ID: config.iosBundleId,
    EXPO_PUBLIC_TENANT_ICON_BG: config.iconBackgroundColor ?? "#FFFFFF",
    EXPO_PUBLIC_API_BASE_URL: config.apiBaseUrl,
    EXPO_PUBLIC_APPLICATION_ID: config.applicationId,
    EXPO_PUBLIC_APP_VERSION: config.version,
    EXPO_PUBLIC_ANDROID_VERSION_CODE: String(config.androidVersionCode),
    EXPO_PUBLIC_IOS_BUILD_NUMBER: config.iosBuildNumber,
    EXPO_PUBLIC_DISTRIBUTION_CHANNEL: config.distributionChannel,
    EXPO_PUBLIC_OTA_CHANNEL: config.otaChannel,
  };
}

export function tenantIconAssets(config) {
  return config.icon;
}
