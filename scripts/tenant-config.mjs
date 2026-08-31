import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function readTenantConfig(slug) {
  if (!slug) throw new Error("EXPO_PUBLIC_TENANT is required");
  const file = resolve(root, "tenants", slug, "tenant.json");
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
