import {
  closeSync,
  copyFileSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
// userInfo() 走 getpwuid，不看 $HOME——os.homedir() 会先看 $HOME，这里要的正是另一个
import { userInfo } from "node:os";
import { readTenantConfig, tenantEnvironment } from "./tenant-config.mjs";
import { loadMachineEnv } from "./lib/machine-env.js";
import {
  appLinkHostOf,
  embeddedPlist,
  exportOptionsPlist,
  iosArtifactProblems,
  plistDate,
  prebuildArgs,
  provisioningProfilePaths,
  xcodebuildDigest,
} from "./lib/ios-release-identity.js";
// 从 `expo/config-plugins` 引，不是 `@expo/config-plugins`：pnpm 的严格模式下后者不是
// 直接依赖，解析不到（2026-09-18 在本仓核实）。
//
// 两处写法都是被真机逼出来的（2026-09-20 第一次在 Mac 上跑到这个脚本）：
//
//  1. 扩展名不能省。`expo` 这个包没有 exports 字段，ESM 下裸规格名不会自动补 `.js`：
//     Cannot find module '.../node_modules/expo/config-plugins'
//  2. 不能用具名导入。`expo/config-plugins.js` 是 `module.exports = require('@expo/config-plugins')`
//     这么一层转发壳，Node 的 CJS 词法分析看不穿它：
//     SyntaxError: Named export 'IOSConfig' not found.
//
// 所以是"默认导入 + 取属性"。
import expoConfigPlugins from "expo/config-plugins.js";

const { IOSConfig } = expoConfigPlugins;

/**
 * iOS release 构建：`pnpm ios:release <slug> [--signing-dir <目录>] [--upload]`。
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
 * ## --signing-dir：打包机上的手工签名
 *
 * 带上它就是**手工签名**：证书在那个目录下的钥匙串里，描述文件在 profiles/<TEAMID>/ 下，
 * 这次构建一把 App Store Connect Key 都不拿。打包机上必须这样——跑构建的那个进程要执行
 * 几千个第三方依赖，而一把能自动申请描述文件的 Key 同时也能上传 build、注册设备、建
 * Ad Hoc 描述文件，于是"这台机器只能签、不能发"就不成立了
 * （RN-Server 设计 ios-mac-builders-home-network-2026-09-18 §4.3）。
 *
 * 不带它就是 Xcode 的自动签名，给开发者在自己的 Mac 上手工跑。两种情况都**不传**
 * `-allowProvisioningUpdates`：这个脚本不申请、也不续期任何描述文件。
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
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const signingDir = option("--signing-dir");
if (signingDir !== undefined && (!signingDir || signingDir.startsWith("--")))
  throw new Error("--signing-dir 要跟一个目录");
const tenantSlug =
  args.find(
    (value, index) =>
      !value.startsWith("--") && args[index - 1] !== "--signing-dir",
  ) ?? process.env.EXPO_PUBLIC_TENANT;
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

/**
 * plist（二进制或 XML）读成对象。macOS 自带 plutil，不引第三方解析器。
 *
 * **只能用在 JSON 表示得了的 plist 上**——也就是整份里没有 `<data>` 与 `<date>`。
 * `Info.plist` 与 codesign 回来的 entitlements 都满足；`.mobileprovision` 不满足，
 * 那份走 readProfileFields()。
 */
const readPlist = (path) =>
  JSON.parse(
    run("plutil", ["-convert", "json", "-o", "-", path], { capture: true }),
  );

/**
 * 从描述文件内嵌的 plist 里取我们要的那三个字段。
 *
 * **不能整份转 JSON。** 描述文件里 `DeveloperCertificates` 与 `DER-Encoded-Profile`
 * 是 `<data>`、`ExpirationDate` 是 `<date>`，这两种类型 JSON 都表示不了，plutil 直接拒绝：
 *
 *   /…/ios/build/profile.plist: Invalid object in plist for JSON format
 *
 * （2026-09-20 真机上撞到，那次 CocoaPods 刚第一次装成功。）所以按 keypath 逐个取。
 * 日期走 `xml1` 而不是 `raw`：XML plist 里的 `<date>` 恒为 ISO-8601 带 Z，格式确定，
 * 而 `raw` 对日期打什么没有承诺。
 *
 * 取不到的键回 null 而不是终止：这个函数要在一堆描述文件上循环，形状不对的那份应该被
 * 跳过，由调用方统一报「没有可用的描述文件」，而不是让第一份坏文件打死整条构建。
 */
const readProfileFields = (path) => {
  const extract = (keypath, format) => {
    const result = spawnSync(
      "plutil",
      ["-extract", keypath, format, "-o", "-", path],
      { env, encoding: "utf8" },
    );
    if (result.error) throw result.error;
    return result.status === 0 ? result.stdout : null;
  };
  return {
    applicationIdentifier:
      extract("Entitlements.application-identifier", "raw")?.trim() || null,
    name: extract("Name", "raw")?.trim() || null,
    uuid: extract("UUID", "raw")?.trim() || null,
    expirationDate: plistDate(extract("ExpirationDate", "xml1")),
  };
};

/**
 * 把描述文件装到 Xcode 会去翻的目录里，返回装进去的那些路径。
 *
 * **只把名字写进工程是不够的。** `PROVISIONING_PROFILE_SPECIFIER` 给的是描述文件的
 * Name，而 Xcode 拿这个名字去它**自己的已安装目录**里找；我们的文件躺在
 * `/var/rn-build-signing/profiles/<TEAMID>/` 下，它根本不知道有这么个文件。
 * 2026-09-21 真机第一次编译起来就倒在这里：
 *
 *   error: No profile for team 'J4JDFC8LCC' matching 'com.anyfun.foundation AppStore 2026'
 *   found: Xcode couldn't find any provisioning profiles matching …
 *   Install the profile (by dragging and dropping it onto Xcode's dock item)…
 *
 * 两个目录都装：Xcode 16 起用 `Developer/Xcode/UserData/Provisioning Profiles`，
 * 更早的版本用 `MobileDevice/Provisioning Profiles`，装两份省得跟版本较劲。
 *
 * 文件名用 UUID：这是 Xcode 一贯的命名约定，重复执行会原样覆盖，不会在目录里堆出
 * 一堆同一份描述文件的副本。
 *
 * **两个"家"都要装。** `$HOME` 与密码数据库里的家目录在打包机上不是同一个东西：任务的
 * `HOME` 是 `<work>/home`（RN-Server 的 `jobspec.go` 设的），而 `_rnbuilder` 在
 * `dscl` 里的 `NFSHomeDirectory` 是 `/var/empty`。2026-09-21 的日志显示 **xcodebuild
 * 自己的进程**把默认 DerivedData 算在了 `/var/empty/Library/Developer/Xcode/…` 下——
 * 也就是说它读的是密码数据库那一个，不是 `$HOME`。两个都装就不必赌是哪一个。
 *
 * `os.userInfo().homedir` 走的是 `getpwuid`，**不看 `$HOME`**（`os.homedir()` 会先看
 * `$HOME`，所以这里不能用它）——正好就是 Xcode 读的那一个。
 *
 * 写不进去**当场失败**，别硬撑：装不上的唯一后果就是二十多分钟后的
 * `** ARCHIVE FAILED **`，那时再报错纯属浪费。报错里直接给出补救命令。
 */
const installProvisioningProfile = (profilePath, uuid) => {
  const homes = [];
  if (env.HOME) homes.push(env.HOME);
  try {
    const passwordDatabaseHome = userInfo().homedir;
    if (passwordDatabaseHome && !homes.includes(passwordDatabaseHome))
      homes.push(passwordDatabaseHome);
  } catch {
    // 取不到就只用 $HOME——不该因为读不出密码数据库而拦住构建
  }
  if (homes.length === 0)
    throw new Error(
      "既没有 HOME 也读不出密码数据库里的家目录，没法把描述文件装进 Xcode 的目录",
    );

  const targets = homes.flatMap((home) => provisioningProfilePaths(home, uuid));
  for (const target of targets) {
    try {
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(profilePath, target);
    } catch (error) {
      throw new Error(
        `描述文件装不进 ${target}：${error.message}\n` +
          "Xcode 按名字找描述文件时翻的就是这些目录，装不上 archive 必然失败。\n" +
          "如果失败的是 /var/empty 底下那一份，说明这个账户的家目录不可写，在 Mac 上补：\n" +
          "  sudo install -d -o _rnbuilder -g _rnbuildjobs -m 0700 /var/rn-build-home\n" +
          "  sudo dscl . -create /Users/_rnbuilder NFSHomeDirectory /var/rn-build-home",
      );
    }
  }
  return targets;
};

// 这里**故意没有**「iOS 平台装没装」的前置检查，别再加回来。2026-09-21 加过一版，
// 判据是 `xcodebuild -showsdks` 里有没有 `-sdk iphoneosN`——**它抓不到**：平台没装时
// 那一行照样在（SDK 一直在 Xcode 包里，缺的是可下载的平台组件），检查原样放行，
// 构建仍然倒在 `Unable to find a destination matching { generic:1, platform:iOS }`。
//
// 而且当时的根因就判错了：archive 在平台缺失时 10 秒内就失败，贵的是它前面那 30 分钟的
// `pod install`——那是**缓存每任务一份**的代价（见 RN-Server 设计文档），不是少了一道
// 前置检查。平台装没装是装机时验一次的事，不是每次构建都验的事，所以挪进了运维手册
// （`sudo xcodebuild -downloadPlatform iOS`，幂等，已装会直接返回）。

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

const iosDirectory = resolve(projectRoot, "ios");

/** `ios/*.xcworkspace`——只有 `pod install` 真的装完了 CocoaPods 才会生成它。 */
const findWorkspace = () => {
  let entries;
  try {
    entries = readdirSync(iosDirectory);
  } catch {
    return undefined; // prebuild 连 ios/ 都没建出来
  }
  return entries
    .filter((entry) => entry.endsWith(".xcworkspace"))
    .map((entry) => resolve(iosDirectory, entry))[0];
};

// prebuild 里的 pod install 要从 github.com clone 几十个仓库，跨度将近二十分钟；
// 链路抖一下整条构建就作废。重试很便宜：已经下好的 pod 在这次任务的 CocoaPods 缓存里
// （HOME 是任务自己的目录），第二次只补没下完的那些。见 prebuildArgs 里为什么只有
// 第一次带 --clean。
//
// **判据是产物，不是退出码。** `expo prebuild` 把 `pod install` 的失败当成 warning，
// 自己照样 exit 0（2026-09-20 真机：⚠️ Something went wrong running `pod install` …
// 之后退出码是 0）。按退出码判会当场跳出循环，重试形同虚设。
const PREBUILD_ATTEMPTS = 3;
let workspace;
for (let attempt = 1; ; attempt++) {
  const result = spawnSync("pnpm", prebuildArgs(attempt), {
    cwd: projectRoot,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  workspace = findWorkspace();
  if (workspace) break;
  if (attempt === PREBUILD_ATTEMPTS) {
    throw new Error(
      `expo prebuild 连续 ${PREBUILD_ATTEMPTS} 次没有产出 ios/*.xcworkspace：CocoaPods 没装或 pod install 失败。\n` +
        "上面最后一段里如果是 `unable to access 'https://github.com/…'`，那是这台机器出网的问题：" +
        "CocoaPods 装每一个 pod 都要 clone 它的 git 源。要走代理的话写进 /var/rn-build-agent/env" +
        "（那里留了注释掉的示例），在 shell 里 export 传不进构建。",
    );
  }
  const wait = attempt * 15;
  console.log(
    `expo prebuild 没装成 CocoaPods（第 ${attempt} 次），${wait} 秒后重试；已经下好的 pod 会被复用`,
  );
  spawnSync("sleep", [String(wait)], { stdio: "ignore" });
}
// scheme 名与 workspace 同名，是 prebuild 从 app.config.ts 的 name 生成的
const scheme = basename(workspace, ".xcworkspace");

const buildDirectory = resolve(projectRoot, "ios", "build");
rmSync(buildDirectory, { recursive: true, force: true });
mkdirSync(buildDirectory, { recursive: true });
const archivePath = resolve(buildDirectory, `${tenant.slug}.xcarchive`);

/**
 * 找这个租户该用的描述文件，返回它的**名字**（不是文件名）。
 *
 * 按文件里的 `application-identifier` 认，不按文件名认：文件名是人起的，而
 * PROVISIONING_PROFILE_SPECIFIER 要的是描述文件里的 Name——两者对不上时 Xcode 报的是
 * "没有匹配的描述文件"，完全看不出是名字写错了。
 */
const findProvisioningProfile = () => {
  const directory = resolve(signingDir, "profiles", tenant.appleTeamId);
  let entries;
  try {
    entries = readdirSync(directory).filter((entry) =>
      entry.endsWith(".mobileprovision"),
    );
  } catch {
    throw new Error(
      `${directory} 读不到：手工签名要求这个 Team 的描述文件放在那里（RN-Server 设计 §4.2）`,
    );
  }
  const wanted = `${tenant.appleTeamId}.${tenant.iosBundleId}`;
  const expired = [];
  for (const entry of entries) {
    const path = resolve(directory, entry);
    const decoded = resolve(buildDirectory, "profile.plist");
    // 前后是二进制、中间是 XML：latin1 读写保证字节原样（见 embeddedPlist）
    writeFileSync(
      decoded,
      embeddedPlist(readFileSync(path, "latin1"), path),
      "latin1",
    );
    const profile = readProfileFields(decoded);
    if (profile.applicationIdentifier !== wanted) continue;
    // 过期的描述文件签出来的包 Apple 直接拒，而报错发生在上传那一步——十几分钟之后。
    // 读不到日期也算不可用：原先写的是 `new Date(undefined).getTime() <= Date.now()`，
    // 那是 `NaN <= …`，恒为 false——缺 ExpirationDate 的文件会被当成没过期直接用掉
    const expiresAt = profile.expirationDate
      ? new Date(profile.expirationDate).getTime()
      : Number.NaN;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      expired.push(
        `${entry}（${profile.expirationDate ?? "读不出 ExpirationDate"}）`,
      );
      continue;
    }
    if (!profile.name)
      throw new Error(
        `${path} 匹配上了 ${wanted}，但读不出 Name——xcodebuild 的 ` +
          "PROVISIONING_PROFILE_SPECIFIER 要的就是这个值，缺了它签名必然失败",
      );
    if (!profile.uuid)
      throw new Error(
        `${path} 匹配上了 ${wanted}，但读不出 UUID——装进 Xcode 的描述文件目录时要用它做文件名`,
      );
    return { name: profile.name, uuid: profile.uuid, path };
  }
  throw new Error(
    `${directory} 下没有 ${wanted} 的可用描述文件` +
      (expired.length > 0
        ? `；已过期或读不出有效期的：${expired.join("、")}`
        : "") +
      "。把这个 App 的 App Store 描述文件放进去再重试。",
  );
};

const archiveSettings = [`DEVELOPMENT_TEAM=${tenant.appleTeamId}`];
let profileName;
if (signingDir) {
  const profile = findProvisioningProfile();
  profileName = profile.name;
  const installed = installProvisioningProfile(profile.path, profile.uuid);
  // 只改 App target 的 Release：命令行上的 PROVISIONING_PROFILE_SPECIFIER 会作用到
  // **每一个** target，包括 Pods 的资源 bundle，而那些 bundle 报的是
  // "does not support provisioning profiles"（expo/expo#29526）。Pods 那一半由
  // plugins/with-ios-pods-unsigned.js 负责关签名
  IOSConfig.ProvisioningProfile.setProvisioningProfileForPbxproj(projectRoot, {
    targetName: scheme,
    profileName,
    appleTeamId: tenant.appleTeamId,
    buildConfiguration: "Release",
    // 这个参数的默认值是旧的 iPhone Distribution，现在签发的证书都是 Apple Distribution
    codeSignIdentity: "Apple Distribution",
  });
  // 钥匙串显式传给 xcodebuild：执行进程的 HOME 是每个任务自己的目录，不赌搜索列表
  // 能被 $HOME 带过去（RN-Server 设计 §4.2）
  archiveSettings.push(
    `OTHER_CODE_SIGN_FLAGS=--keychain ${resolve(signingDir, "rn-signing.keychain-db")}`,
  );
  // 把装到哪儿也打出来：下次再出 "couldn't find any provisioning profiles" 时，
  // 这一行能立刻分清是"没装上"还是"装了但 Xcode 没往这儿找"
  console.log(
    `manual signing: profile ${profileName} (${profile.uuid})\n` +
      installed.map((path) => `  installed: ${path}`).join("\n"),
  );
}

// DerivedData 显式落在任务目录里，不交给 Xcode 自己挑。
//
// **Xcode 不认 `$HOME`。** 执行进程的 HOME 是每个任务自己的目录（RN-Server 的
// `jobspec.go` 里 `HOME=<work>/home`），但 xcodebuild 与它底下那些框架取的是目录服务里
// 这个账户的家目录——`_rnbuilder` 的是 `/var/empty`，谁都写不进去。2026-09-21 真机日志：
//
//   IDELogStore: Failed to open log store at
//     /var/empty/Library/Developer/Xcode/DerivedData/AnyFun-…/Logs/Build
//     (513) You don't have permission to save the file "Build" in the folder "Logs"
//
// 那次是先倒在 destination 上，这些只是警告；真编译起来 DerivedData 写不进去就是硬失败。
// 放进任务目录还顺带满足了「任务之间不共享状态、用完随任务一起删」。
const derivedDataPath = resolve(buildDirectory, "DerivedData");

/**
 * 跑 xcodebuild，完整输出写进任务目录里的文件，控制台只打摘要。
 *
 * 控制台的构建日志只留最后 200 行，一次 archive 却有上万行——不这么做，失败时真正的
 * `error:` 行和这个脚本自己的诊断行都会被挤出窗口（见 xcodebuildDigest 的注释）。
 *
 * 输出直接落到文件描述符上，不经过这个进程的内存：`spawnSync` 收 stdout 有 maxBuffer
 * 上限，超了会把子进程杀掉，而 archive 的输出轻易上几十 MB。
 *
 * 这段时间控制台上是安静的，不要紧：打包机按心跳判断存活，不看有没有输出。
 */
const runXcodebuild = (label, xcodebuildArgs) => {
  mkdirSync(buildDirectory, { recursive: true });
  const logPath = resolve(buildDirectory, `xcodebuild-${label}.log`);
  console.log(`xcodebuild ${label} 开始；完整输出写进 ${logPath}`);
  const fd = openSync(logPath, "w");
  let result;
  try {
    result = spawnSync("xcodebuild", xcodebuildArgs, {
      cwd: projectRoot,
      env,
      stdio: ["ignore", fd, fd],
    });
  } finally {
    closeSync(fd);
  }
  if (result.error) throw result.error;
  const output = readFileSync(logPath, "utf8");
  if (result.status !== 0) {
    console.error(
      `xcodebuild ${label} 失败（退出码 ${result.status}）\n${xcodebuildDigest(output)}`,
    );
    process.exit(result.status ?? 1);
  }
  const banner = output.match(/\*\* [A-Z ]+ SUCCEEDED \*\*/)?.[0] ?? "";
  console.log(
    `xcodebuild ${label} 完成 ${banner}（${output.split("\n").length} 行输出）`,
  );
};

runXcodebuild("archive", [
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
  "-derivedDataPath",
  derivedDataPath,
  // **不传 -allowProvisioningUpdates**：这个脚本不申请、也不续期任何描述文件。
  // 手工签名时证书与描述文件由人放在机器上（设计 §4.3、§4.4）
  ...archiveSettings,
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
    // `--xml` 是必须的：不带它的老写法（`--entitlements :-`）在 Xcode 11 之前会在
    // plist 前面加一段二进制魔数，而这里是按 utf8 收 stdout 的——那几个字节会被解码
    // 坏掉，然后 plutil 报一个与真正原因无关的解析错误。
    writeFileSync(
      path,
      run("codesign", ["-d", "--entitlements", "-", "--xml", appDirectory], {
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
  exportOptionsPlist({
    teamId: tenant.appleTeamId,
    bundleId: profileName ? tenant.iosBundleId : undefined,
    profileName,
  }),
);
const exportDirectory = resolve(buildDirectory, "export");
runXcodebuild("export", [
  "-exportArchive",
  "-archivePath",
  archivePath,
  "-exportOptionsPlist",
  exportOptions,
  "-exportPath",
  exportDirectory,
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
// copyFileSync 而不是读进内存再写：.ipa 动辄上百 MB
copyFileSync(exported, artifact);
console.log(`iOS release IPA: ${artifact}`);

// ---- 上传 App Store Connect ----
//
// 必须显式 --upload。上传是一个**对外可见**的动作：包一旦进了 App Store Connect
// 就能被分发给测试员，而且撤不回来，只能再出一个 build 顶掉它。默认不做。
//
// **打包机不走这条路**：那边的上传由另一个账户（_rnuploader）用独立的上传 Key 做，
// 跑构建的这个进程一把 App Store Connect Key 都没有（RN-Server 设计 §4.3）。
// 这里留着的是开发者在自己的 Mac 上手工发一版的路径。
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
