const { spawnSync } = require("node:child_process");
const { existsSync, readdirSync } = require("node:fs");
const { join } = require("node:path");

/**
 * Release APK 身份门禁（安全评审 N1 / N16 / N18 / N20）。
 * 构建脚本与 CI 在复制产物前调用：签名者必须等于 tenant.json 登记的生产密钥指纹，
 * 永远拒绝 React Native 模板的公开 debug 密钥；包名、versionCode、versionName 与租户一致；
 * 不得出现被禁止的权限。任一不符即失败，不复制、不上传。
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
  if (problems.length > 0)
    throw new Error(
      `Release identity check failed:\n- ${problems.join("\n- ")}`,
    );
  return { signer: signers[0], ...badging };
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

function runTool(binary, args) {
  const result = spawnSync(binary, args, { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${binary} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  return `${result.stdout}\n${result.stderr}`;
}

function inspectApk({ apkPath, sdkRoot }) {
  if (!existsSync(apkPath)) throw new Error(`APK not found: ${apkPath}`);
  const signers = parseSignerDigests(
    runTool(findBuildTool(sdkRoot, "apksigner"), [
      "verify",
      "--print-certs",
      apkPath,
    ]),
  );
  const badging = parseBadging(
    runTool(findBuildTool(sdkRoot, "aapt"), ["dump", "badging", apkPath]),
  );
  return { signers, badging };
}

function verifyReleaseApk({ apkPath, tenant, sdkRoot }) {
  const inspected = inspectApk({ apkPath, sdkRoot });
  return assertReleaseIdentity({ ...inspected, tenant });
}

module.exports = {
  ALLOWED_PERMISSIONS,
  DEBUG_SIGNER_SHA256,
  DIRECT_ONLY_PERMISSIONS,
  FORBIDDEN_PERMISSIONS,
  allowedPermissionsFor,
  SHA256_HEX,
  assertReleaseIdentity,
  findBuildTool,
  inspectApk,
  parseBadging,
  parseSignerDigests,
  verifyReleaseApk,
};
