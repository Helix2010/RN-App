import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readTenantConfig, tenantEnvironment } from "./tenant-config.mjs";
import { loadMachineEnv } from "./lib/machine-env.js";
import {
  appLinkHostOf,
  exportOptionsPlist,
  iosArtifactProblems,
} from "./lib/ios-release-identity.js";

/**
 * iOS release 构建：`pnpm ios:release <slug> [--upload]`。
 *
 * 产物是 `artifacts/<slug>-<version>-build<n>.ipa`，出口是 TestFlight
 * （设计 RN-Server docs/design/ios-testflight-distribution-2026-09-17.md）。
 *
 * ## 与 Android 那条链的不对称，别照搬结论
 *
 * Android 那套是"构建机出未签名包、签名闸单独签"，构建机从头到尾碰不到签名密钥。
 * iOS 做不到：`xcodebuild -exportArchive` 时签名就已经发生，这台 Mac 必然同时持有
 * 源码和签名身份。补偿在 Apple 侧——证书随时可吊销、分发通道由 Apple 托管、用户装
 * 的那一份由 Apple 重新签名——但不等于零风险（设计 §4.2、§8.4）。
 *
 * ## 为什么要显式设 EXPO_OS
 *
 * app.config.ts 用 `process.env.EXPO_OS === "ios"` 决定内嵌的 build 号取哪一个，
 * 而 @expo/cli 的 prebuild **不设**这个变量（2026-09-17 在 SDK 57 上实测）。漏设
 * 之后 Info.plist 是对的、运行时请求头也是对的，只有 OTA 那条链错，而且在设备上
 * 完全看不出来。所以这里显式设置，并在产物门禁里独立复验一次——设一个环境变量是
 * 一行代码，忘了设的症状是"iOS 永远收不到热更新"。
 */

const projectRoot = process.cwd();

// 本机构建输入放 .env.local（git 忽略），这样发一版不需要在命令行上摆一串环境变量
const MACHINE_ENV_KEYS = [
  // OTA 信任根：证书是公钥材料，路径与开关都不是秘密
  "EXPO_UPDATES_CODE_SIGNING_CERTIFICATE",
  "EXPO_REQUIRE_OTA_SIGNING",
  // App Store Connect API Key（只在 --upload 时用到）。ASC_KEY_ID / ASC_ISSUER_ID
  // 不是秘密；.p8 本身由 altool 按约定目录去找，不经过这个脚本、不落命令行
  "ASC_KEY_ID",
  "ASC_ISSUER_ID",
];

loadMachineEnv(
  process.env.RN_ENV_ROOT && process.env.JEST_WORKER_ID
    ? resolve(process.env.RN_ENV_ROOT)
    : projectRoot,
  MACHINE_ENV_KEYS,
);

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const tenantSlug =
  args.find((value) => !value.startsWith("--")) ??
  process.env.EXPO_PUBLIC_TENANT;
const tenant = readTenantConfig(tenantSlug);

if (tenant.distributionChannel === "development")
  throw new Error("iOS release cannot use the development channel");
if (!tenant.appleTeamId)
  throw new Error(
    `tenants/${tenant.slug}/tenant.json is missing appleTeamId: iOS builds need it as DEVELOPMENT_TEAM. ` +
      "管理端「iOS 打包与分发 → 应用身份」登记后由服务端合成的 tenant.json 会带上它。",
  );

const apiBaseUrl = tenant.apiBaseUrl;
if (
  !apiBaseUrl?.startsWith("https://") ||
  apiBaseUrl.includes("localhost") ||
  apiBaseUrl.includes("127.0.0.1")
)
  throw new Error("iOS release requires a non-local HTTPS apiBaseUrl");

const env = {
  ...process.env,
  ...tenantEnvironment(tenant),
  NODE_ENV: "production",
  // 见文件头：CLI 不会替我们设，漏设的症状是 iOS 永远收不到热更新
  EXPO_OS: "ios",
};

if (
  /^(1|true|yes|on)$/i.test(env.EXPO_REQUIRE_OTA_SIGNING ?? "") &&
  !env.EXPO_UPDATES_CODE_SIGNING_CERTIFICATE
)
  throw new Error(
    "EXPO_REQUIRE_OTA_SIGNING is on but EXPO_UPDATES_CODE_SIGNING_CERTIFICATE is missing: the release would ship without an OTA trust root",
  );

if (flag("--check-env")) {
  console.log(
    JSON.stringify({
      tenant: tenant.slug,
      apiBaseUrl,
      appleTeamId: tenant.appleTeamId,
      bundleId: tenant.iosBundleId,
      version: tenant.version,
      buildNumber: tenant.iosBuildNumber,
      expoOs: env.EXPO_OS,
    }),
  );
  process.exit(0);
}

// 从这里往下都要 Xcode。放在 --check-env 之后：排查配置不该需要一台 Mac
if (process.platform !== "darwin")
  throw new Error(
    `iOS release builds require macOS with Xcode; this machine is ${process.platform}. ` +
      "用 --check-env 可以在任何机器上检查这个租户的 iOS 配置。",
  );

const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
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

/** plist（二进制或 XML）读成对象。macOS 自带 plutil，不引第三方解析器。 */
const readPlist = (path) =>
  JSON.parse(
    run("plutil", ["-convert", "json", "-o", "-", path], { capture: true }),
  );

const expoConfig = JSON.parse(
  run("pnpm", ["exec", "expo", "config", "--json"], { capture: true }),
);
// 先在这里比一次 build 号：一次 archive 十几分钟，让"环境变量漏设"这种一秒钟就能
// 判定的事等到产物门禁才说，是在浪费人的时间
if (String(expoConfig.extra?.buildNumber) !== tenant.iosBuildNumber)
  throw new Error(
    `内嵌 extra.buildNumber 是 ${expoConfig.extra?.buildNumber}，应为 iosBuildNumber ${tenant.iosBuildNumber}：` +
      "EXPO_OS=ios 没有传到 expo config（见 app.config.ts 里 buildNumber 的取值）",
  );

run("pnpm", ["exec", "expo", "prebuild", "--platform", "ios", "--clean"]);

const iosDirectory = resolve(projectRoot, "ios");
const workspace = readdirSync(iosDirectory)
  .filter((entry) => entry.endsWith(".xcworkspace"))
  .map((entry) => resolve(iosDirectory, entry))[0];
if (!workspace)
  throw new Error(
    "expo prebuild 没有产出 ios/*.xcworkspace：CocoaPods 没装或 pod install 失败",
  );
// scheme 名与 workspace 同名，是 prebuild 从 app.config.ts 的 name 生成的
const scheme = basename(workspace, ".xcworkspace");

const buildDirectory = resolve(projectRoot, "ios", "build");
rmSync(buildDirectory, { recursive: true, force: true });
mkdirSync(buildDirectory, { recursive: true });
const archivePath = resolve(buildDirectory, `${tenant.slug}.xcarchive`);

run("xcodebuild", [
  "-workspace",
  workspace,
  "-scheme",
  scheme,
  "-configuration",
  "Release",
  "-destination",
  "generic/platform=iOS",
  "-archivePath",
  archivePath,
  // 证书与描述文件由 Xcode 用 ASC API Key 申请与续期，不手工搬 .p12（设计 §4.3）
  "-allowProvisioningUpdates",
  `DEVELOPMENT_TEAM=${tenant.appleTeamId}`,
  "archive",
]);

// ---- 产物门禁：逐条比对 archive 里的东西与租户配置 ----
const appDirectory = readdirSync(resolve(archivePath, "Products/Applications"))
  .filter((entry) => entry.endsWith(".app"))
  .map((entry) => resolve(archivePath, "Products/Applications", entry))[0];
if (!appDirectory) throw new Error(`archive 里没有 .app：${archivePath}`);
const infoPlist = readPlist(resolve(appDirectory, "Info.plist"));
// entitlements 只能从签名里读回来，不能读工程里那份源文件——我们要验的是**这个包
// 实际带着什么**，而不是工程打算给它什么
const entitlements = readPlist(
  (() => {
    const path = resolve(buildDirectory, "entitlements.plist");
    writeFileSync(
      path,
      run("codesign", ["-d", "--entitlements", ":-", appDirectory], {
        capture: true,
      }),
    );
    return path;
  })(),
);

const problems = iosArtifactProblems({
  infoPlist,
  entitlements,
  expoConfig,
  tenant,
  appLinkHost: appLinkHostOf(apiBaseUrl),
});
if (problems.length > 0)
  throw new Error(`iOS 产物门禁不通过：\n- ${problems.join("\n- ")}`);
console.log(
  `iOS archive verified: ${infoPlist.CFBundleIdentifier} ${infoPlist.CFBundleShortVersionString} (${infoPlist.CFBundleVersion})`,
);

// ---- 导出 .ipa ----
const exportOptions = resolve(buildDirectory, "ExportOptions.plist");
writeFileSync(
  exportOptions,
  exportOptionsPlist({ teamId: tenant.appleTeamId }),
);
const exportDirectory = resolve(buildDirectory, "export");
run("xcodebuild", [
  "-exportArchive",
  "-archivePath",
  archivePath,
  "-exportOptionsPlist",
  exportOptions,
  "-exportPath",
  exportDirectory,
  "-allowProvisioningUpdates",
]);
const exported = readdirSync(exportDirectory)
  .filter((entry) => entry.endsWith(".ipa"))
  .map((entry) => resolve(exportDirectory, entry))[0];
if (!exported) throw new Error(`导出目录里没有 .ipa：${exportDirectory}`);

const artifactDirectory = resolve(projectRoot, "artifacts");
mkdirSync(artifactDirectory, { recursive: true });
const artifact = resolve(
  artifactDirectory,
  `${tenant.slug}-${tenant.version}-build${tenant.iosBuildNumber}.ipa`,
);
writeFileSync(artifact, readFileSync(exported));
console.log(`iOS release IPA: ${artifact}`);

// ---- 上传 App Store Connect ----
//
// 必须显式 --upload。上传是一个**对外可见**的动作：包一旦进了 App Store Connect
// 就能被分发给测试员，而且撤不回来，只能再出一个 build 顶掉它。默认不做。
if (!flag("--upload")) {
  console.log(
    "未上传（加 --upload 才传 App Store Connect）。上传后记下过期日：每个 TestFlight build 90 天后失效。",
  );
  process.exit(0);
}
if (!env.ASC_KEY_ID || !env.ASC_ISSUER_ID)
  throw new Error(
    "--upload 需要 ASC_KEY_ID 与 ASC_ISSUER_ID（放 .env.local）；.p8 放 ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8，权限 600",
  );
// .p8 不经过这个脚本、也不进命令行参数：altool 自己按约定目录去找
run("xcrun", [
  "altool",
  "--upload-app",
  "--type",
  "ios",
  "--file",
  artifact,
  "--apiKey",
  env.ASC_KEY_ID,
  "--apiIssuer",
  env.ASC_ISSUER_ID,
]);
console.log(
  "已上传 App Store Connect。Apple 处理完成后：\n" +
    "  1. 回答出口合规问卷（设计 §8.2，工程不替租户回答）；\n" +
    "  2. `pnpm asc:check` 确认 build 与过期日；\n" +
    "  3. 外部测试组与公开链接由人在 ASC 上点，平台不自动做（设计 §4.6.6）。",
);
