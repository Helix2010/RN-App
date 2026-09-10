import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  readDevelopmentIdentity,
  readTenantConfig,
  tenantsRoot,
} from "./tenant-config.mjs";

const eas = JSON.parse(
  readFileSync(resolve(process.cwd(), "eas.json"), "utf8"),
);
const expectedChannels = {
  development: "development",
  staging: "staging",
  "production-store": "store",
  "android-direct": "direct",
  "ios-mdm": "mdm",
};
const expectedOtaChannels = {
  development: "development",
  staging: "staging",
  "production-store": "production",
  "android-direct": "production",
  "ios-mdm": "production",
};

for (const [profileName, expectedChannel] of Object.entries(expectedChannels)) {
  const profile = eas.build?.[profileName];
  if (!profile) {
    throw new Error(`Missing EAS build profile: ${profileName}`);
  }

  const channel = profile.env?.EXPO_PUBLIC_DISTRIBUTION_CHANNEL;
  if (channel !== expectedChannel) {
    throw new Error(
      `${profileName} must use distribution channel ${expectedChannel}, received ${channel ?? "missing"}`,
    );
  }

  const otaChannel = profile.env?.EXPO_PUBLIC_OTA_CHANNEL;
  if (otaChannel !== expectedOtaChannels[profileName]) {
    throw new Error(
      `${profileName} must use OTA channel ${expectedOtaChannels[profileName]}, received ${otaChannel ?? "missing"}`,
    );
  }

  if (profileName === "development") {
    const applicationId = profile.env?.EXPO_PUBLIC_APPLICATION_ID;
    if (
      typeof applicationId !== "string" ||
      !/^[a-z0-9][a-z0-9_-]{1,119}$/.test(applicationId)
    ) {
      throw new Error(`${profileName} must declare a valid application id`);
    }
    const apiBaseUrl = profile.env?.EXPO_PUBLIC_API_BASE_URL;
    if (apiBaseUrl !== "http://localhost:3000") {
      throw new Error("Development must use the documented local API URL");
    }
    continue;
  }

  if (
    profile.env?.EXPO_PUBLIC_API_BASE_URL ||
    profile.env?.EXPO_PUBLIC_APPLICATION_ID
  ) {
    throw new Error(
      `${profileName} must not duplicate tenant API or application settings; use tenants/<slug>/tenant.json`,
    );
  }
}

// 无租户开发构建的身份（tenants/development-identity.json，app.config.ts 读同一份）：
// 不得与任何生产租户相同（安全评审 N20）
const DEV_BUILD_IDENTITY = readDevelopmentIdentity();

const tenants = readdirSync(tenantsRoot(), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const tenant = readTenantConfig(entry.name);
    if (tenant.slug !== entry.name)
      throw new Error(`${entry.name}: tenant slug mismatch`);
    return tenant;
  });
// 租户之间的应用身份必须唯一：同包名 + 同签名的两个租户在同一台设备上会互相覆盖（N20）
for (const key of ["androidPackage", "iosBundleId", "scheme"]) {
  const seen = new Map();
  for (const tenant of tenants) {
    const value = tenant[key];
    if (seen.has(value))
      throw new Error(
        `${tenant.slug}: ${key} ${value} is already used by tenant ${seen.get(value)}`,
      );
    seen.set(value, tenant.slug);
  }
}
for (const tenant of tenants) {
  if (
    tenant.androidPackage === DEV_BUILD_IDENTITY.androidPackage ||
    tenant.iosBundleId === DEV_BUILD_IDENTITY.iosBundleId ||
    tenant.androidPackage.endsWith(".dev")
  )
    throw new Error(
      `${tenant.slug}: production identity must not equal the no-tenant development build identity`,
    );
}
for (const tenant of tenants) {
  const slug = tenant.slug;
  if (
    !tenant.apiBaseUrl.startsWith("https://") ||
    tenant.apiBaseUrl.includes("localhost") ||
    tenant.apiBaseUrl.includes("127.0.0.1")
  ) {
    throw new Error(`${slug}: production API must use non-local HTTPS`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(tenant.version)) {
    throw new Error(`${slug}: version must be semver`);
  }
  if (
    !Number.isInteger(tenant.androidVersionCode) ||
    tenant.androidVersionCode < 1
  ) {
    throw new Error(`${slug}: androidVersionCode must be a positive integer`);
  }
}

console.log(
  "EAS profiles are tenant-neutral and tenant build configs are valid.",
);
