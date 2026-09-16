const { spawnSync } = require("node:child_process");
const { existsSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const { readZipDirectory, readZipEntry } = require("./apk-zip");

/**
 * Release APK 身份门禁（安全评审 N1 / N16 / N18 / N20；签名闸设计 android-signing-gate-2026-09-16）。
 *
 * 两种包，两套检查：
 * - **未签名包**（`pnpm android:release` 的产物，构建机交给签名闸的就是它）：断言没有任何
 *   签名，再查包名、版本、权限与内嵌配置。这些只是早期反馈——签名闸会独立再查一遍，
 *   它不采信构建机说的话。
 * - **已签名包**（签名闸产出、从控制台下载的包，`pnpm android:verify` 复核）：签名者必须
 *   等于 tenant.json 登记的证书指纹，永远拒绝 React Native 模板的公开 debug 密钥，
 *   其余同上。
 * 任一不符即失败，不复制、不上传。
 */

/** React Native 模板 debug.keystore 的证书指纹：谁都有这把钥匙。 */
const DEBUG_SIGNER_SHA256 =
  "fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c";
const FORBIDDEN_PERMISSIONS = ["android.permission.SYSTEM_ALERT_WINDOW"];

/**
 * 允许出现在正式包里的权限清单（安全评审 N28 / A2-3）。
 *
 * 基线取自已上线的 anyfun 1.3.7 (33)，用 `aapt dump badging` 逐条核对过。
 * 只有禁用列表是不够的：真正危险的是**新冒出来**的权限——某个依赖升级顺手加了
 * 录音、定位或读联系人，禁用列表永远不会提到它，而装机用户看到的是一个权限
 * 变多了的钱包。改成允许列表之后，任何没在这里写明的权限都会让构建失败，
 * 要加就必须有人在这份表上留下一行。
 *
 * 加新权限的规矩：先确认它是哪个依赖带进来的、能不能去掉；确实需要就加在这里，
 * 并在变更记录里写清楚为什么。不要为了让构建过去而一次性放宽。
 */
const ALLOWED_PERMISSIONS = [
  // 网络与后台
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.ACCESS_WIFI_STATE",
  "android.permission.INTERNET",
  "android.permission.RECEIVE_BOOT_COMPLETED",
  "android.permission.WAKE_LOCK",
  // 通知与推送
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.VIBRATE",
  "com.google.android.c2dm.permission.RECEIVE",
  "com.google.android.finsky.permission.BIND_GET_INSTALL_REFERRER_SERVICE",
  // 生物识别（金库解锁与转出确认）
  "android.permission.USE_BIOMETRIC",
  "android.permission.USE_FINGERPRINT",
  // 扫码收款地址 / WalletConnect 配对码
  "android.permission.CAMERA",
  // 截屏保护要知道用户截了图（expo-screen-capture）
  "android.permission.DETECT_SCREEN_CAPTURE",
  // 选图（头像、凭证上传）；新系统走 READ_MEDIA_IMAGES，旧系统退回存储权限
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  // 角标：各家桌面自己的私有权限，来自角标库
  "android.permission.READ_APP_BADGE",
  "com.anddoes.launcher.permission.UPDATE_COUNT",
  "com.htc.launcher.permission.READ_SETTINGS",
  "com.htc.launcher.permission.UPDATE_SHORTCUT",
  "com.huawei.android.launcher.permission.CHANGE_BADGE",
  "com.huawei.android.launcher.permission.READ_SETTINGS",
  "com.huawei.android.launcher.permission.WRITE_SETTINGS",
  "com.majeur.launcher.permission.UPDATE_BADGE",
  "com.oppo.launcher.permission.READ_SETTINGS",
  "com.oppo.launcher.permission.WRITE_SETTINGS",
  "com.sec.android.provider.badge.permission.READ",
  "com.sec.android.provider.badge.permission.WRITE",
  "com.sonyericsson.home.permission.BROADCAST_BADGE",
  "com.sonymobile.home.permission.PROVIDER_INSERT_BADGE",
  "me.everything.badger.permission.BADGE_COUNT_READ",
  "me.everything.badger.permission.BADGE_COUNT_WRITE",
];

/**
 * 只有直发渠道能声明的权限：应用内装 APK。商店包带着它既过不了审，也说明
 * 构建拿错了渠道配置，所以这里按渠道分别判定而不是一律放行。
 */
const DIRECT_ONLY_PERMISSIONS = ["android.permission.REQUEST_INSTALL_PACKAGES"];

/** 这一条带包名前缀，逐租户不同，由 RN 的 broadcast receiver 生成。 */
function dynamicReceiverPermission(androidPackage) {
  return `${androidPackage}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`;
}

/** 这个租户这次构建允许出现的全部权限。 */
function allowedPermissionsFor(tenant) {
  const allowed = new Set(ALLOWED_PERMISSIONS);
  allowed.add(dynamicReceiverPermission(tenant.androidPackage));
  if (tenant.distributionChannel === "direct")
    for (const permission of DIRECT_ONLY_PERMISSIONS) allowed.add(permission);
  return allowed;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** `apksigner verify --print-certs` 输出里的全部证书 SHA-256（去重、小写）。 */
function parseSignerDigests(output) {
  const digests = new Set();
  for (const line of output.split(/\r?\n/)) {
    const match = /certificate SHA-256 digest:\s*([0-9a-fA-F]{64})/.exec(line);
    if (match) digests.add(match[1].toLowerCase());
  }
  return [...digests];
}

/** `aapt dump badging` 输出：包名、版本与权限清单。 */
function parseBadging(output) {
  const pkg =
    /^package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'/m.exec(
      output,
    );
  if (!pkg) throw new Error("aapt badging output has no package line");
  const permissions = new Set();
  // `uses-permission-sdk-23:` 是 minSdk≥23 才生效的声明，同样是清单的一部分
  for (const match of output.matchAll(
    /^uses-permission(?:-sdk-23)?: name='([^']+)'/gm,
  ))
    permissions.add(match[1]);
  return {
    packageName: pkg[1],
    versionCode: Number(pkg[2]),
    versionName: pkg[3],
    permissions: [...permissions].sort(),
  };
}

/** 包名、版本、权限：已签名与未签名两种包共用的那一半。返回问题列表，空 = 通过。 */
function packageIdentityProblems({ badging, tenant }) {
  const problems = [];
  if (badging.packageName !== tenant.androidPackage)
    problems.push(
      `package ${badging.packageName} does not match tenant androidPackage ${tenant.androidPackage}`,
    );
  if (badging.versionCode !== tenant.androidVersionCode)
    problems.push(
      `versionCode ${badging.versionCode} does not match tenant androidVersionCode ${tenant.androidVersionCode}`,
    );
  if (badging.versionName !== tenant.version)
    problems.push(
      `versionName ${badging.versionName} does not match tenant version ${tenant.version}`,
    );
  for (const permission of FORBIDDEN_PERMISSIONS)
    if (badging.permissions.includes(permission))
      problems.push(`forbidden permission declared: ${permission}`);
  const allowed = allowedPermissionsFor(tenant);
  const unexpected = badging.permissions.filter(
    (permission) =>
      !allowed.has(permission) && !FORBIDDEN_PERMISSIONS.includes(permission),
  );
  if (unexpected.length > 0)
    problems.push(
      `permissions not on the allow list (a dependency probably added them; confirm each one, then add it to ALLOWED_PERMISSIONS with a reason): ${unexpected.join(", ")}`,
    );
  return problems;
}

/** 已签名包（签名闸产出）：签名者 = tenant.json 登记的指纹，外加包名、版本、权限。 */
function assertReleaseIdentity({ signers, badging, tenant }) {
  const problems = [];
  if (signers.length !== 1)
    // 0 个签名者或多个（含 v3.1 轮换链）都拒绝：直发渠道当前只接受单一生产密钥
    problems.push(
      `expected exactly one signer certificate, found ${signers.length}`,
    );
  if (signers.includes(DEBUG_SIGNER_SHA256))
    problems.push(
      "APK is signed with the public React Native debug keystore (fac61745…); release builds must use the tenant production key",
    );
  if (
    typeof tenant.signerSha256 !== "string" ||
    !SHA256_HEX.test(tenant.signerSha256)
  )
    problems.push(
      "tenant.json signerSha256 must be the production certificate SHA-256 (64 lowercase hex chars)",
    );
  else if (signers.length === 1 && signers[0] !== tenant.signerSha256)
    problems.push(
      `signer ${signers[0]} does not match tenant.json signerSha256 ${tenant.signerSha256}`,
    );
  problems.push(...packageIdentityProblems({ badging, tenant }));
  if (problems.length > 0)
    throw new Error(
      `Release identity check failed:\n- ${problems.join("\n- ")}`,
    );
  return { signer: signers[0], ...badging };
}

/** v1（JAR）签名文件：直接放在 META-INF/ 下的 .SF 与签名块文件。 */
const V1_SIGNATURE_ENTRY = /^META-INF\/[^/]+\.(SF|RSA|DSA|EC)$/i;

/**
 * 从 ZIP 结构里找签名痕迹，不需要 Android SDK：v1 签名文件，以及中央目录前的
 * APK Signing Block（v2/v3/v3.1 签名都在里面）。返回每条痕迹的说明，空 = 没有。
 */
function signatureEvidence(apkPath) {
  const { entries, hasApkSigningBlock } = readZipDirectory(apkPath);
  const evidence = entries
    .filter((entry) => V1_SIGNATURE_ENTRY.test(entry.name))
    .map((entry) => `v1 signature file ${entry.name}`);
  if (hasApkSigningBlock)
    evidence.push("APK Signing Block before the central directory");
  return evidence;
}

/**
 * `apksigner verify` 对一个没签名的包必须失败，而且失败原因必须是“验证不通过”——
 * 工具本身跑不起来（没有 java、找不到 jar）也是非 0 退出，那不能算作“没有签名”的证据。
 * 返回问题列表，空 = 确实验证不通过。
 */
function apksignerVerifyProblems({ apkPath, sdkRoot, env }) {
  const binary = findBuildTool(sdkRoot, "apksigner");
  const result = spawnSync(binary, ["verify", apkPath], {
    encoding: "utf8",
    env,
  });
  if (result.error) throw result.error;
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status === 0)
    return [
      "apksigner verify accepts this APK, so it carries a valid signature",
    ];
  if (!output.includes("DOES NOT VERIFY"))
    throw new Error(
      `apksigner verify could not examine ${apkPath} (exit ${result.status}); that is not evidence the APK is unsigned: ${output.trim().slice(0, 2000)}`,
    );
  return [];
}

/**
 * 断言 APK 没有任何签名：ZIP 结构里没有签名痕迹，且 `apksigner verify` 验证不通过。
 * release 构建只出未签名包，签名只在签名闸上做。
 */
function unsignedProblems({ apkPath, sdkRoot, env }) {
  const evidence = signatureEvidence(apkPath);
  if (evidence.length > 0)
    return [
      `APK is already signed (${evidence.join("; ")}); release builds must be unsigned — only the signing gate signs`,
    ];
  return apksignerVerifyProblems({ apkPath, sdkRoot, env });
}

function assertApkUnsigned({ apkPath, sdkRoot, env }) {
  if (!existsSync(apkPath)) throw new Error(`APK not found: ${apkPath}`);
  const problems = unsignedProblems({ apkPath, sdkRoot, env });
  if (problems.length > 0)
    throw new Error(`Unsigned APK check failed:\n- ${problems.join("\n- ")}`);
}

/** APK 内嵌的 `assets/app.config`（expo-constants 在构建时写进去的那份）。 */
function readEmbeddedAppConfig(apkPath) {
  const raw = readZipEntry(apkPath, "assets/app.config");
  if (raw === null) throw new Error("APK has no embedded assets/app.config");
  return JSON.parse(raw.toString("utf8"));
}

/**
 * 内嵌配置与这次构建期望的是否一致：租户域名、渠道、应用身份、版本、Build、OTA、runtimeVersion。
 * `expected.extra` 逐键比对，`expected.runtimeVersion` 必须相等，OTA 必须开启。
 */
function embeddedConfigProblems({ appConfig, expected }) {
  const problems = [];
  for (const [key, value] of Object.entries(expected.extra))
    if (appConfig.extra?.[key] !== value)
      problems.push(
        `embedded app.config ${key}: expected ${value}, received ${appConfig.extra?.[key] ?? "missing"}`,
      );
  if (!appConfig.updates?.enabled)
    problems.push("embedded app.config must enable production OTA updates");
  if (appConfig.runtimeVersion !== expected.runtimeVersion)
    problems.push(
      `embedded app.config runtimeVersion ${appConfig.runtimeVersion} does not match Expo config ${expected.runtimeVersion}`,
    );
  return problems;
}

/** 最高版本 build-tools 目录里的工具；找不到就报错，不去 PATH 里碰运气。 */
function findBuildTool(sdkRoot, tool) {
  const root = join(sdkRoot, "build-tools");
  if (!existsSync(root))
    throw new Error(`Android SDK build-tools not found under ${sdkRoot}`);
  const versions = readdirSync(root)
    .filter((name) => /^\d+\.\d+\.\d+/.test(name))
    .sort((left, right) =>
      right.localeCompare(left, undefined, { numeric: true }),
    );
  for (const version of versions) {
    const candidate = join(root, version, tool);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`${tool} not found in any ${root}/<version>/`);
}

function runTool(binary, args, env) {
  const result = spawnSync(binary, args, { encoding: "utf8", env });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${binary} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  return `${result.stdout}\n${result.stderr}`;
}

/** `aapt dump badging`：包名、版本与权限清单。 */
function inspectBadging({ apkPath, sdkRoot, env }) {
  if (!existsSync(apkPath)) throw new Error(`APK not found: ${apkPath}`);
  return parseBadging(
    runTool(findBuildTool(sdkRoot, "aapt"), ["dump", "badging", apkPath], env),
  );
}

/** `apksigner verify --print-certs`：签名证书 SHA-256；验证不通过直接报错。 */
function inspectSigners({ apkPath, sdkRoot, env }) {
  if (!existsSync(apkPath)) throw new Error(`APK not found: ${apkPath}`);
  return parseSignerDigests(
    runTool(
      findBuildTool(sdkRoot, "apksigner"),
      ["verify", "--print-certs", apkPath],
      env,
    ),
  );
}

/**
 * 未签名 release 包的早期反馈：没有签名、包名/版本/权限与租户一致、内嵌配置与这次构建一致。
 * 全部问题一次报出。
 */
function verifyUnsignedReleaseApk({
  apkPath,
  tenant,
  sdkRoot,
  expectedConfig,
  env,
}) {
  if (!existsSync(apkPath)) throw new Error(`APK not found: ${apkPath}`);
  const problems = unsignedProblems({ apkPath, sdkRoot, env });
  const badging = inspectBadging({ apkPath, sdkRoot, env });
  problems.push(...packageIdentityProblems({ badging, tenant }));
  problems.push(
    ...embeddedConfigProblems({
      appConfig: readEmbeddedAppConfig(apkPath),
      expected: expectedConfig,
    }),
  );
  if (problems.length > 0)
    throw new Error(
      `Unsigned release check failed:\n- ${problems.join("\n- ")}`,
    );
  return badging;
}

/** 已签名包（签名闸产出）的复核：`pnpm android:verify`。 */
function verifySignedReleaseApk({ apkPath, tenant, sdkRoot, env }) {
  const signers = inspectSigners({ apkPath, sdkRoot, env });
  const badging = inspectBadging({ apkPath, sdkRoot, env });
  return assertReleaseIdentity({ signers, badging, tenant });
}

module.exports = {
  ALLOWED_PERMISSIONS,
  DEBUG_SIGNER_SHA256,
  DIRECT_ONLY_PERMISSIONS,
  FORBIDDEN_PERMISSIONS,
  allowedPermissionsFor,
  assertApkUnsigned,
  assertReleaseIdentity,
  embeddedConfigProblems,
  findBuildTool,
  inspectBadging,
  inspectSigners,
  parseBadging,
  parseSignerDigests,
  readEmbeddedAppConfig,
  signatureEvidence,
  verifySignedReleaseApk,
  verifyUnsignedReleaseApk,
};
