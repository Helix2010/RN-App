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

  const bundleContent = readFileSync(bundleSource);
  const manifest = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    runtimeVersion:
      runtimeVersionOverride ??
      runtimeVersion(
        platform,
        apiBaseUrl,
        channel,
        distributionChannel,
        applicationId,
      ),
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
} finally {
  rmSync(exportDir, { recursive: true, force: true });
  rmSync(packageDir, { recursive: true, force: true });
}

function runtimeVersion(
  targetPlatform,
  targetApiBaseUrl,
  targetChannel,
  targetDistributionChannel,
  targetApplicationId,
) {
  const output = execFileSync(
    "pnpm",
    [
      "exec",
      "expo-updates",
      "fingerprint:generate",
      "--platform",
      targetPlatform,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        EXPO_PUBLIC_API_BASE_URL: targetApiBaseUrl,
        EXPO_PUBLIC_DISTRIBUTION_CHANNEL: targetDistributionChannel,
        EXPO_PUBLIC_OTA_CHANNEL: targetChannel,
        EXPO_PUBLIC_APPLICATION_ID: targetApplicationId,
      },
    },
  ).trim();
  const parsed = JSON.parse(output);
  if (!parsed.hash) fail("无法从 Expo Fingerprint 获取 Runtime Version");
  return parsed.hash;
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
