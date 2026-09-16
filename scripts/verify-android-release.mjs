import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { readTenantConfig } from "./tenant-config.mjs";
import { verifySignedReleaseApk } from "./lib/android-release-identity.js";
import { loadMachineEnv } from "./lib/machine-env.js";

/**
 * 复核一个**签名闸产出**的正式包（从控制台下载的那个）：
 *   node scripts/verify-android-release.mjs <apk> <tenant-slug>
 * 签名者必须等于 tenants/<slug>/tenant.json 的 signerSha256，不是公开 debug 密钥；
 * 包名、版本、权限与租户一致。
 * 需要 ANDROID_HOME / ANDROID_SDK_ROOT（可放在 .env.local）。退出码非 0 = 不得分发。
 */
const [apkArg, slugArg] = process.argv.slice(2);
if (!apkArg || !slugArg) {
  console.error(
    "Usage: node scripts/verify-android-release.mjs <apk> <tenant-slug>",
  );
  process.exit(2);
}
loadMachineEnv(process.cwd(), ["ANDROID_HOME", "ANDROID_SDK_ROOT"]);
const sdkRoot = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (!sdkRoot || !existsSync(sdkRoot)) {
  console.error("ANDROID_HOME must point at an installed Android SDK");
  process.exit(2);
}
const tenant = readTenantConfig(slugArg);
try {
  const identity = verifySignedReleaseApk({
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
