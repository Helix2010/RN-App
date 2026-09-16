import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readTenantConfig, tenantEnvironment } from "./tenant-config.mjs";
import { verifyUnsignedReleaseApk } from "./lib/android-release-identity.js";
import { loadMachineEnv } from "./lib/machine-env.js";
import {
  TARGET_RELATIVE_PATH as VERIFICATION_METADATA_PATH,
  enforcementProblem,
} from "../plugins/with-gradle-dependency-verification.js";

/**
 * Android release 构建：`pnpm android:release <slug>`。
 *
 * 产物是**未签名**的 `artifacts/<slug>-<version>-build<code>-release-unsigned.apk`。
 * 正式签名只在签名闸上做（RN-Server `docs/design/android-signing-gate-2026-09-16.md`）：
 * 构建机执行几千个第三方依赖的代码，按不可信处理，这个脚本因此不读、也不需要任何
 * 签名材料。复制产物前的检查（没有签名、包名/版本/权限、内嵌配置）是早期反馈，
 * 签名闸会独立再查一遍。
 */

const projectRoot = process.cwd();

// Machine-level build inputs live in the git-ignored .env.local (or .env), so a
// release needs no command-line environment: `pnpm android:release <slug>`.
const MACHINE_ENV_KEYS = [
  "ANDROID_HOME",
  "ANDROID_SDK_ROOT",
  "JAVA_HOME",
  "GOOGLE_SERVICES_JSON",
  // OTA 信任根：证书本身是公钥材料，路径与开关都不是秘密
  "EXPO_UPDATES_CODE_SIGNING_CERTIFICATE",
  "EXPO_REQUIRE_OTA_SIGNING",
];
/**
 * 清单里的组件数下限。低于这个值说明这次构建解析到的依赖比一次完整 release 少
 * （任务被 up-to-date 跳过、配置没求值到），写出去就是一份会被强制执行的残缺清单。
 * 2026-09-11 的基线是 1309。
 */
const MIN_VERIFIED_COMPONENTS = 1000;

/** 清单里钉住的组件条数。 */
const countPinnedComponents = (path) =>
  (readFileSync(path, "utf8").match(/<component /g) ?? []).length;

// 脚本测试用临时目录隔离开发者本机的 .env.local（RN_ENV_ROOT 只在 Jest 子进程里生效）；构建永远读仓库根
loadMachineEnv(
  process.env.RN_ENV_ROOT && process.env.JEST_WORKER_ID
    ? resolve(process.env.RN_ENV_ROOT)
    : projectRoot,
  MACHINE_ENV_KEYS,
);
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
// （buildscript 类路径、各个 Expo 子工程、变体相关的依赖）。
const writingVerificationMetadata = process.argv.includes(
  "--write-verification-metadata",
);
if (writingVerificationMetadata) {
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

// Gradle 依赖校验在 release 构建里强制执行，没有开关。
const installedVerificationMetadata = resolve(
  projectRoot,
  "android",
  VERIFICATION_METADATA_PATH,
);
if (writingVerificationMetadata) {
  // 重新生成时去掉 prebuild 装进去的旧清单：否则就是拿旧清单去校验、再把旧条目
  // 连同校验结果一起并进新清单。只有这条生成命令会这样做。
  rmSync(installedVerificationMetadata, { force: true });
} else {
  // prebuild 之后、构建之前留下一条"校验确实会发生"的正向证据。
  // 理由见 enforcementProblem 的注释：这条检查成功时是静默的，绿色本身不说明它跑过。
  const present = existsSync(installedVerificationMetadata);
  const components = present
    ? countPinnedComponents(installedVerificationMetadata)
    : 0;
  const problem = enforcementProblem({
    installed: present,
    components,
    floor: MIN_VERIFIED_COMPONENTS,
  });
  if (problem) throw new Error(problem);
  console.log(
    `Gradle dependency verification: enforcing ${components} pinned components`,
  );
}

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
  // 一份残缺的清单比没有更坏：它会被强制执行，然后在别人手里炸成"依赖校验失败"
  const components = countPinnedComponents(generated);
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

// release buildType 没有 signingConfig（plugins/with-release-signing.js），AGP 产出的就是这个文件名。
const outputDirectory = resolve(
  projectRoot,
  "android/app/build/outputs/apk/release",
);
const output = resolve(outputDirectory, "app-release-unsigned.apk");
if (!existsSync(output)) {
  if (existsSync(resolve(outputDirectory, "app-release.apk")))
    throw new Error(
      "Gradle wrote a signed app-release.apk instead of app-release-unsigned.apk: something injected a signing config " +
        "(a signingConfig in build.gradle, android.injected.signing.* properties, or ORG_GRADLE_PROJECT_* variables). " +
        "Release builds must be unsigned; only the signing gate signs.",
    );
  throw new Error(`Gradle did not produce ${output}`);
}
// 复制前的门禁（早期反馈，签名闸会独立再查）：没有签名、包名/版本/权限、内嵌配置
const identity = verifyUnsignedReleaseApk({
  apkPath: output,
  tenant,
  sdkRoot,
  env,
  expectedConfig: {
    extra: {
      apiBaseUrl,
      distributionChannel: env.EXPO_PUBLIC_DISTRIBUTION_CHANNEL,
      otaChannel: env.EXPO_PUBLIC_OTA_CHANNEL,
      applicationId: env.EXPO_PUBLIC_APPLICATION_ID,
      appVersion: config.version,
      buildNumber: String(config.android.versionCode),
    },
    runtimeVersion: config.runtimeVersion,
  },
});
console.log(
  `Unsigned release verified: ${identity.packageName} ${identity.versionName} (${identity.versionCode}) · ${identity.permissions.length} permissions · no signature`,
);
const artifactDirectory = resolve(projectRoot, "artifacts");
mkdirSync(artifactDirectory, { recursive: true });
const artifact = resolve(
  artifactDirectory,
  `${tenant.slug}-${config.version}-build${config.android.versionCode}-release-unsigned.apk`,
);
copyFileSync(output, artifact);
console.log(`Android unsigned release APK: ${artifact}`);
