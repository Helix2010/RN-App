import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const value = process.argv[index];
  if (!value.startsWith("--")) continue;
  const key = value.slice(2);
  const next = process.argv[index + 1];
  if (!next || next.startsWith("--")) args.set(key, "true");
  else {
    args.set(key, next);
    index += 1;
  }
}

const platform = args.get("platform");
const channel = args.get("channel") ?? "staging";
const distributionChannel =
  args.get("distribution-channel") ??
  (channel === "staging" ? "staging" : platform === "ios" ? "mdm" : "direct");
const applicationId =
  args.get("application-id") ??
  process.env.EXPO_PUBLIC_APPLICATION_ID ??
  "dex-mobile";
const apiBaseUrl =
  args.get("api-base-url") ?? process.env.EXPO_PUBLIC_API_BASE_URL;
const zipPath = resolve(
  args.get("output-zip") ??
    join(process.cwd(), `ota-${platform ?? "unknown"}-${channel}.zip`),
);
const applyStrategy = args.get("apply-strategy") ?? "next_launch";
const runtimeVersionOverride = args.get("runtime-version");
const allowDirty = args.get("allow-dirty") === "true";
const resolvedExpoConfig = JSON.parse(
  execFileSync(
    "pnpm",
    ["exec", "expo", "config", "--json", "--type", "public"],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        EXPO_PUBLIC_API_BASE_URL: apiBaseUrl,
        EXPO_PUBLIC_DISTRIBUTION_CHANNEL: distributionChannel,
        EXPO_PUBLIC_OTA_CHANNEL: channel,
        EXPO_PUBLIC_APPLICATION_ID: applicationId,
        EXPO_OS: platform,
      },
    },
  ),
);
// 热更新包必须对准"正在分发的那一版"的 runtime，否则一台设备都收不到它。
//
// 这个值以前取自 expo config，而 expo config 读的是仓库里的 tenants/<slug>/
// tenant.json。自从 App 身份改由服务端下发（版本号来自打包任务），仓库那份就不再跟着
// 走了——2026-09-12 它停在 1.3.7，而线上分发的是 1.3.12。照它构建会产出一个没有任何
// 设备能用的包，而且构建、上传、发布每一步都会成功，直到没人收到更新为止。
//
// 所以改成向服务端要。取不到就直接失败：默默退回一个可能过期的值，正是上面那个故障
// 的成因。--runtime-version 仍然保留，作为离线或首发时的显式出口。
async function runtimeVersionFromServer(targetPlatform, targetApiBaseUrl) {
  const endpoint =
    targetApiBaseUrl.replace(/\/+$/, "") +
    "/v1/public/releases/latest?platform=" +
    encodeURIComponent(targetPlatform);
  let response;
  try {
    response = await fetch(endpoint, {
      headers: { accept: "application/json" },
    });
  } catch (error) {
    fail(
      `连不上 ${endpoint}（${error.message}）。离线构建请用 --runtime-version 显式指定。`,
    );
  }
  if (!response.ok) {
    fail(
      `向 ${endpoint} 取当前分发版本失败（HTTP ${response.status}）。` +
        "这个租户还没有已发布的版本时，用 --runtime-version 显式指定。",
    );
  }
  const body = await response.json();
  const value = body && body.runtimeVersion;
  if (typeof value !== "string" || value.trim() === "") {
    fail(
      `服务端没有返回 runtimeVersion（${endpoint}）。服务端版本过旧，或该平台没有在分发的版本；` +
        "用 --runtime-version 显式指定。",
    );
  }
  return value.trim();
}

const resolvedRuntimeVersion =
  runtimeVersionOverride ??
  (await runtimeVersionFromServer(platform, apiBaseUrl));

if (!platform || !["android", "ios"].includes(platform)) {
  fail(
    "用法：pnpm ota:build --platform <android|ios> --channel <staging|production>",
  );
}
if (!/^[a-z][a-z0-9-]{1,39}$/.test(channel)) {
  fail("channel 只能包含小写字母、数字和连字符");
}
if (
  !new Set(["development", "staging", "store", "direct", "mdm"]).has(
    distributionChannel,
  )
) {
  fail(
    "--distribution-channel 必须是 development、staging、store、direct 或 mdm",
  );
}
if (!apiBaseUrl || !/^https:\/\//.test(apiBaseUrl)) {
  fail("需要提供 HTTPS 租户 API 地址，例如 https://api.anyfun.win");
}
if (!["next_launch", "immediate"].includes(applyStrategy)) {
  fail("--apply-strategy 只能是 next_launch 或 immediate");
}

const gitStatus = execFileSync("git", ["status", "--porcelain"], {
  encoding: "utf8",
});
if (gitStatus.trim() && !allowDirty) {
  fail("工作区存在未提交修改。请提交后构建，或显式使用 --allow-dirty");
}

const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const apiOrigin = new URL(apiBaseUrl).origin;
const exportDir = mkdtempSync(join(tmpdir(), "rn-ota-export-"));
const packageDir = mkdtempSync(join(tmpdir(), "rn-ota-package-"));

try {
  execFileSync(
    "pnpm",
    [
      "exec",
      "expo",
      "export",
      "--platform",
      platform,
      "--output-dir",
      exportDir,
      "--dump-assetmap",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        EXPO_PUBLIC_API_BASE_URL: apiBaseUrl,
        EXPO_PUBLIC_DISTRIBUTION_CHANNEL: distributionChannel,
        EXPO_PUBLIC_OTA_CHANNEL: channel,
        EXPO_PUBLIC_APPLICATION_ID: applicationId,
      },
    },
  );

  const metadata = readJson(join(exportDir, "metadata.json"));
  const platformMetadata = metadata.fileMetadata?.[platform];
  if (!platformMetadata?.bundle) {
    fail(`Expo 导出没有找到 ${platform} Bundle`);
  }

  const bundlePath = normalizeRelative(platformMetadata.bundle);
  const bundleSource = join(exportDir, bundlePath);
  if (!existsSync(bundleSource)) fail(`Bundle 文件不存在：${bundlePath}`);
  cpFile(bundleSource, join(packageDir, bundlePath));

  const assets = [];
  for (const item of platformMetadata.assets ?? []) {
    const assetPath = normalizeRelative(item.path);
    const source = join(exportDir, assetPath);
    if (!existsSync(source)) fail(`Asset 文件不存在：${assetPath}`);
    const extension = item.ext ?? extname(assetPath).slice(1);
    const archivePath = `${assetPath}.${extension}`;
    cpFile(source, join(packageDir, archivePath));
    const content = readFileSync(source);
    assets.push({
      path: archivePath,
      key: createHash("sha256").update(content).digest("hex"),
      url: archivePath,
      contentType: contentType(extension),
      fileExtension: extension,
      hash: digest(content),
    });
  }

  // 原生面指纹：只看自动链接的原生模块、原生配置和 expo config，不看 JS 源码——
  // 正是"要不要重新编译原生"这个问题的定义。服务端拿它和基线安装包记录的那个比：
  // 不一致就说明这次改动动了原生，不能走热更新（设备会去调一个 APK 里不存在的原生
  // 模块，表现是所有装了那一版的设备启动即崩）。
  //
  // 算不出来就直接失败，不留空：留空等于把这道闸悄悄关掉，而它防的是一次全量崩溃。
  const fingerprint = (() => {
    const raw = execFileSync("pnpm", ["exec", "fingerprint", "."], {
      encoding: "utf8",
      cwd: process.cwd(),
      env: { ...process.env, EXPO_PUBLIC_API_BASE_URL: apiBaseUrl },
      maxBuffer: 64 * 1024 * 1024,
    });
    const value = JSON.parse(raw)?.hash;
    if (typeof value !== "string" || value.trim() === "") {
      fail("@expo/fingerprint 没有算出指纹；服务端会拒绝没有指纹的热更新包");
    }
    return value.trim();
  })();

  const bundleContent = readFileSync(bundleSource);
  const manifest = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    runtimeVersion: resolvedRuntimeVersion,
    platform,
    channel,
    extra: {
      scopeKey: apiOrigin,
      // expo-constants resolves Constants.expoConfig from this nested
      // standard Expo Updates field after a remote OTA launch.
      expoClient: resolvedExpoConfig,
      apiBaseUrl,
      distributionChannel,
      otaChannel: channel,
      applicationId,
      nativeFingerprint: fingerprint,
      appVersion: resolvedExpoConfig.version,
      buildNumber:
        platform === "ios"
          ? resolvedExpoConfig.ios?.buildNumber
          : String(resolvedExpoConfig.android?.versionCode ?? "0"),
    },
    metadata: { channel, applyStrategy, sourceCommitSha: commitSha },
    launchAsset: {
      path: bundlePath,
      key: createHash("sha256").update(bundleContent).digest("hex"),
      url: bundlePath,
      contentType: "application/javascript",
      fileExtension: extname(bundlePath).slice(1) || "js",
      hash: digest(bundleContent),
    },
    assets,
  };
  writeFileSync(
    join(packageDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  mkdirSync(dirname(zipPath), { recursive: true });
  execFileSync("zip", ["-q", "-X", "-r", zipPath, "."], {
    cwd: packageDir,
    stdio: "inherit",
  });

  console.log(`OTA package: ${zipPath}`);
  console.log(`platform: ${platform}`);
  console.log(`channel: ${channel}`);
  console.log(`distributionChannel: ${distributionChannel}`);
  console.log(`applicationId: ${applicationId}`);
  console.log(`runtimeVersion: ${manifest.runtimeVersion}`);
  if (runtimeVersionOverride) console.log("runtimeVersionSource: override");
  console.log(`sourceCommitSha: ${commitSha}`);
  console.log(`bundle: ${bundlePath}`);
  console.log(`assets: ${assets.length}`);
  console.log(`applyStrategy: ${applyStrategy}`);
  console.log(`nativeFingerprint: ${fingerprint}`);
} finally {
  rmSync(exportDir, { recursive: true, force: true });
  rmSync(packageDir, { recursive: true, force: true });
}

function cpFile(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
}

function normalizeRelative(value) {
  const normalized = value.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  ) {
    fail(`非法资源路径：${value}`);
  }
  return normalized;
}

function digest(content) {
  return createHash("sha256").update(content).digest("base64url");
}

function contentType(extension) {
  const types = {
    hbc: "application/javascript",
    js: "application/javascript",
    json: "application/json",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    ttf: "font/ttf",
    woff: "font/woff",
    woff2: "font/woff2",
  };
  return types[extension.toLowerCase()] ?? "application/octet-stream";
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`无法读取 JSON：${path} (${error.message})`);
  }
}

function fail(message) {
  console.error(`OTA 构建失败：${message}`);
  process.exit(1);
}
