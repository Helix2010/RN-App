import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readTenantConfig, tenantEnvironment } from "./tenant-config.mjs";

const projectRoot = process.cwd();
const tenantSlug =
  process.argv.slice(2).find((value) => !value.startsWith("--")) ??
  process.env.EXPO_PUBLIC_TENANT;
const tenant = readTenantConfig(tenantSlug);
const apiBaseUrl = tenant.apiBaseUrl;
if (
  !apiBaseUrl?.startsWith("https://") ||
  apiBaseUrl.includes("localhost") ||
  apiBaseUrl.includes("127.0.0.1")
) {
  throw new Error(
    "Android Release requires a non-local HTTPS EXPO_PUBLIC_API_BASE_URL",
  );
}

const env = {
  ...process.env,
  ...tenantEnvironment(tenant),
  NODE_ENV: "production",
  EXPO_PUBLIC_DISTRIBUTION_CHANNEL: tenant.distributionChannel,
  EXPO_PUBLIC_OTA_CHANNEL: tenant.otaChannel,
  EXPO_PUBLIC_APPLICATION_ID: tenant.applicationId,
};

if (env.EXPO_PUBLIC_DISTRIBUTION_CHANNEL === "development") {
  throw new Error("Android Release cannot use the development channel");
}
if (process.argv.includes("--check-env")) {
  console.log(
    JSON.stringify({
      tenant: tenant.slug,
      apiBaseUrl,
      distributionChannel: env.EXPO_PUBLIC_DISTRIBUTION_CHANNEL,
      otaChannel: env.EXPO_PUBLIC_OTA_CHANNEL,
      applicationId: env.EXPO_PUBLIC_APPLICATION_ID,
    }),
  );
  process.exit(0);
}

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    env,
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (options.capture && result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
};

const config = JSON.parse(
  run("pnpm", ["exec", "expo", "config", "--json"], { capture: true }),
);
run("pnpm", ["exec", "expo", "prebuild", "--platform", "android", "--clean"]);
run("./gradlew", ["assembleRelease"], { cwd: resolve(projectRoot, "android") });

const embeddedConfigPath = resolve(
  projectRoot,
  "android/app/build/intermediates/assets/release/mergeReleaseAssets/app.config",
);
const embeddedConfig = JSON.parse(readFileSync(embeddedConfigPath, "utf8"));
const expected = {
  apiBaseUrl,
  distributionChannel: env.EXPO_PUBLIC_DISTRIBUTION_CHANNEL,
  otaChannel: env.EXPO_PUBLIC_OTA_CHANNEL,
  applicationId: env.EXPO_PUBLIC_APPLICATION_ID,
  appVersion: config.version,
  buildNumber: String(config.android.versionCode),
};
for (const [key, value] of Object.entries(expected)) {
  if (embeddedConfig.extra?.[key] !== value)
    throw new Error(
      `Embedded APK config mismatch for ${key}: expected ${value}, received ${embeddedConfig.extra?.[key] ?? "missing"}`,
    );
}
if (!embeddedConfig.updates?.enabled)
  throw new Error("Embedded APK config must enable production OTA updates");
if (embeddedConfig.runtimeVersion !== config.runtimeVersion)
  throw new Error("Embedded APK runtimeVersion does not match Expo config");

const output = resolve(
  projectRoot,
  "android/app/build/outputs/apk/release/app-release.apk",
);
const artifactDirectory = resolve(projectRoot, "artifacts");
mkdirSync(artifactDirectory, { recursive: true });
const artifact = resolve(
  artifactDirectory,
  `${tenant.slug}-${config.version}-build${config.android.versionCode}-release.apk`,
);
copyFileSync(output, artifact);
console.log(`Android release APK: ${artifact}`);
