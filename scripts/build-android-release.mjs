import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readTenantConfig, tenantEnvironment } from "./tenant-config.mjs";
import {
  SHA256_HEX,
  verifyReleaseApk,
} from "./lib/android-release-identity.js";
import { missingReleaseSigningEnv } from "../plugins/with-release-signing.js";

const projectRoot = process.cwd();

// Machine-level build inputs live in the git-ignored .env.local (or .env), so a
// release needs no command-line environment: `pnpm android:release <slug>`.
// Expo already reads these files for app.config; this loads the same values
// for the Gradle step. Existing process.env values win, like Expo's loader.
const MACHINE_ENV_KEYS = [
  "ANDROID_HOME",
  "ANDROID_SDK_ROOT",
  "JAVA_HOME",
  "GOOGLE_SERVICES_JSON",
  // keystore 的路径不是秘密；口令与别名只能来自进程环境（密钥管理服务注入），不读 .env
  "ANDROID_RELEASE_KEYSTORE_PATH",
  // OTA 信任根：证书本身是公钥材料，路径与开关都不是秘密
  "EXPO_UPDATES_CODE_SIGNING_CERTIFICATE",
  "EXPO_REQUIRE_OTA_SIGNING",
];
// 脚本测试用临时目录隔离开发者本机的 .env.local（RN_ENV_ROOT 只在 Jest 子进程里生效）；构建永远读仓库根
/**
 * 清单里的组件数下限。低于这个值说明这次构建解析到的依赖比一次完整 release 少
 * （任务被 up-to-date 跳过、配置没求值到），写出去就是一份会被强制执行的残缺清单。
 * 2026-09-11 的基线是 1309。
 */
const MIN_VERIFIED_COMPONENTS = 1000;

const envRoot =
  process.env.RN_ENV_ROOT && process.env.JEST_WORKER_ID
    ? resolve(process.env.RN_ENV_ROOT)
    : projectRoot;
for (const file of [".env.local", ".env"]) {
  const path = resolve(envRoot, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match || !MACHINE_ENV_KEYS.includes(match[1])) continue;
    const value = match[2].replace(/^(['"])(.*)\1$/, "$2");
    if (value !== "" && process.env[match[1]] === undefined)
      process.env[match[1]] = value;
  }
}
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

const sdkRoot = env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT;
if (!sdkRoot || !existsSync(sdkRoot)) {
  throw new Error(
    "ANDROID_HOME must point at an installed Android SDK; set it in .env.local",
  );
}
env.ANDROID_HOME = sdkRoot;
if (env.GOOGLE_SERVICES_JSON) {
  if (!existsSync(env.GOOGLE_SERVICES_JSON))
    throw new Error(
      `GOOGLE_SERVICES_JSON points to a missing file: ${env.GOOGLE_SERVICES_JSON}`,
    );
} else if (!process.argv.includes("--no-push")) {
  throw new Error(
    "GOOGLE_SERVICES_JSON is required so the release can register for push; set it in .env.local or pass --no-push to build without FCM on purpose",
  );
}

// 发布身份门禁（安全评审 N1）：租户必须登记生产签名证书指纹，签名材料只来自环境；缺任一项不开始构建
if (
  typeof tenant.signerSha256 !== "string" ||
  !SHA256_HEX.test(tenant.signerSha256)
) {
  throw new Error(
    `tenants/${tenant.slug}/tenant.json must pin signerSha256 (SHA-256 of the production signing certificate, 64 lowercase hex) before a release can be built; see docs/SAAS_TENANT_BUILD_RUNBOOK.md §3`,
  );
}
// OTA 真实性门禁（安全评审 N19）：开关打开后，缺 per-tenant 代码签名证书就不开始构建。
// app.config.ts 里也有同一条判定——那条在 expo prebuild 才触发，这条让 pnpm android:release
// 在跑任何构建步骤之前就说清楚缺什么。
if (
  /^(1|true|yes|on)$/i.test(env.EXPO_REQUIRE_OTA_SIGNING ?? "") &&
  !env.EXPO_UPDATES_CODE_SIGNING_CERTIFICATE
) {
  throw new Error(
    "EXPO_REQUIRE_OTA_SIGNING is on but EXPO_UPDATES_CODE_SIGNING_CERTIFICATE is missing: the release would ship without an OTA trust root; see docs/SAAS_TENANT_BUILD_RUNBOOK.md",
  );
}
const missingSigning = missingReleaseSigningEnv(env);
if (missingSigning.length > 0) {
  throw new Error(
    `Release signing requires ${missingSigning.join(", ")} in the environment (inject them from the secret store, never commit them); see docs/SAAS_TENANT_BUILD_RUNBOOK.md §3`,
  );
}
// Gradle 的 file() 相对 android/app 解析，脚本相对仓库根：相对路径会一边通过一边失败，只收绝对路径
if (!isAbsolute(env.ANDROID_RELEASE_KEYSTORE_PATH)) {
  throw new Error(
    `ANDROID_RELEASE_KEYSTORE_PATH must be an absolute path, received ${env.ANDROID_RELEASE_KEYSTORE_PATH}`,
  );
}
if (!existsSync(env.ANDROID_RELEASE_KEYSTORE_PATH)) {
  throw new Error(
    `ANDROID_RELEASE_KEYSTORE_PATH points to a missing file: ${env.ANDROID_RELEASE_KEYSTORE_PATH}`,
  );
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

// --write-verification-metadata：重新生成 Gradle 依赖校验清单（安全评审 N28）。
// 走真实的 release 构建而不是 `:app:dependencies`——只有真实构建才覆盖得到所有配置
// （buildscript 类路径、各个 Expo 子工程、变体相关的依赖）。生成期间必须把校验本身
// 关掉，否则就是拿旧清单去校验、然后用校验失败的结果写新清单。
const writingVerificationMetadata = process.argv.includes(
  "--write-verification-metadata",
);
if (writingVerificationMetadata) {
  env.GRADLE_DEPENDENCY_VERIFICATION = "0";
  // 必须在**冷缓存**下生成，这一条是实测出来的，不是保险起见：
  // 暖缓存里 Gradle 用的是已解析的模块元数据，不会重读原始 .pom / .module，
  // 于是那些文件根本不会被记进清单。2026-09-11 第一次用开发机缓存生成的清单，
  // 在冷缓存下就差一条 guava-parent-33.3.1-jre.pom（buildscript classpath），
  // 直接把构建打挂——而 CI 的 runner 每次都是冷的。
  // 代价是重新生成要把依赖整套下一遍（约 1 GB / 十几分钟），但这是个低频操作。
  env.GRADLE_USER_HOME = mkdtempSync(join(tmpdir(), "rn-gradle-verify-"));
  console.log(
    `Generating verification metadata against a cold Gradle cache: ${env.GRADLE_USER_HOME}`,
  );
}

const config = JSON.parse(
  run("pnpm", ["exec", "expo", "config", "--json"], { capture: true }),
);
run("pnpm", ["exec", "expo", "prebuild", "--platform", "android", "--clean"]);
run(
  "./gradlew",
  writingVerificationMetadata
    ? ["--write-verification-metadata", "sha256", "assembleRelease"]
    : ["assembleRelease"],
  { cwd: resolve(projectRoot, "android") },
);
if (writingVerificationMetadata) {
  const generated = resolve(
    projectRoot,
    "android/gradle/verification-metadata.xml",
  );
  if (!existsSync(generated))
    throw new Error(
      "Gradle did not write android/gradle/verification-metadata.xml",
    );
  const contents = readFileSync(generated, "utf8");
  // 一份残缺的清单比没有更坏：它会被强制执行，然后在别人手里炸成"依赖校验失败"
  const components = (contents.match(/<component /g) ?? []).length;
  if (components < MIN_VERIFIED_COMPONENTS)
    throw new Error(
      `verification-metadata.xml only lists ${components} components (floor ${MIN_VERIFIED_COMPONENTS}); the build resolved less than a full release does`,
    );
  const target = resolve(projectRoot, "gradle/verification-metadata.xml");
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(generated, target);
  console.log(
    `Gradle dependency verification metadata: ${components} components → ${target}`,
  );
  rmSync(env.GRADLE_USER_HOME, { recursive: true, force: true });
}

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
// 复制前的最后一道门禁：签名者 = 租户登记的生产密钥（永远拒绝模板 debug 密钥）、包名/版本一致、无禁用权限
const identity = verifyReleaseApk({ apkPath: output, tenant, sdkRoot });
console.log(
  `Release identity verified: signer ${identity.signer} · ${identity.packageName} ${identity.versionName} (${identity.versionCode}) · ${identity.permissions.length} permissions`,
);
const artifactDirectory = resolve(projectRoot, "artifacts");
mkdirSync(artifactDirectory, { recursive: true });
const artifact = resolve(
  artifactDirectory,
  `${tenant.slug}-${config.version}-build${config.android.versionCode}-release.apk`,
);
copyFileSync(output, artifact);
console.log(`Android release APK: ${artifact}`);
