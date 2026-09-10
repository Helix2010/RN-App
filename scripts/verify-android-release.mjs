import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readTenantConfig } from "./tenant-config.mjs";
import { verifyReleaseApk } from "./lib/android-release-identity.js";

/**
 * 对一个已构建的 APK 复跑发布身份门禁（CI、复核、事后取证都用它）：
 *   node scripts/verify-android-release.mjs <apk> <tenant-slug>
 * 需要 ANDROID_HOME / ANDROID_SDK_ROOT（可放在 .env.local）。退出码非 0 = 不得分发。
 */
const [apkArg, slugArg] = process.argv.slice(2);
if (!apkArg || !slugArg) {
  console.error(
    "Usage: node scripts/verify-android-release.mjs <apk> <tenant-slug>",
  );
  process.exit(2);
}
for (const file of [".env.local", ".env"]) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match =
      /^\s*(?:export\s+)?(ANDROID_HOME|ANDROID_SDK_ROOT)\s*=\s*(.*?)\s*$/.exec(
        line,
      );
    if (!match) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    if (value !== "" && process.env[match[1]] === undefined)
      process.env[match[1]] = value;
  }
}
const sdkRoot = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (!sdkRoot || !existsSync(sdkRoot)) {
  console.error("ANDROID_HOME must point at an installed Android SDK");
  process.exit(2);
}
const tenant = readTenantConfig(slugArg);
try {
  const identity = verifyReleaseApk({
    apkPath: resolve(process.cwd(), apkArg),
    tenant,
    sdkRoot,
  });
  console.log(
    JSON.stringify(
      {
        apk: apkArg,
        tenant: tenant.slug,
        signerSha256: identity.signer,
        packageName: identity.packageName,
        versionName: identity.versionName,
        versionCode: identity.versionCode,
        permissions: identity.permissions.length,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
