#!/usr/bin/env node
/**
 * 给一个发布产物生成 SBOM（安全评审 §12.2「每个 artifact 生成 SBOM…与构建 provenance」）。
 *
 * 为什么需要它，而不是靠已经接进 CI 的 `pnpm audit`：audit 回答的是"**今天**这棵
 * 依赖树里有哪些**已知**漏洞"，扫完就过期；SBOM 回答的是"**已经发出去的那个包里
 * 装的是哪个版本**"。等某个包明天爆新 CVE，要判断用户手机上那个 1.3.7 受不受影响，
 * 有 SBOM 是查一个文件，没有就得把当时的 commit 重新 checkout、重装依赖去推导。
 *
 * ## 扫什么：实测结论（2026-09-11，syft 1.51.1）
 *
 * | 扫描目标            | 结果                                                     |
 * | ------------------- | -------------------------------------------------------- |
 * | Android APK 本身    | **0 个组件**。代码在 classes.dex 里，syft 没有 dex 编目器 |
 * | 整个仓库目录        | 1689 个，其中约 27% 是噪声                               |
 * | `pnpm-lock.yaml`    | 1230 个 npm 包，全部带版本，零噪声                       |
 *
 * 仓库目录扫出来的噪声全部来自 `node_modules` 内部 vendor 的文件：
 * `react-native-qrcode-svg` 里的 Gemfile.lock（38 个 gem）、`react-native-svg` 里的
 * Windows 工程（10 个 nuget）、Expo 各包的 `-sources` jar（伪装成 maven）。
 * 这些东西一个都不会进 APK，写进 SBOM 只会让人以为产物里有它们。
 *
 * 所以这里扫 lockfile。
 *
 * ## 它覆盖不到什么（不要假装覆盖到了）
 *
 * **Android 原生依赖不在里面。** RN/Expo 工程没有 Gradle 依赖锁定，仓库里没有任何
 * 一份权威的原生依赖清单可读；APK 里又是 dex，扫不出来。要补上这一半，前置条件是
 * N28 里另一项欠账——给 Gradle 加 `verification-metadata.xml`，那份文件本身就是
 * 权威的 Android 依赖列表。在那之前，这份 SBOM 的 `coverage` 属性会如实写着
 * `javascript-only`，不要把它当成完整的物料清单。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * 组件数低于这个值就认定是扫描失败而不是"依赖真的很少"。
 *
 * 这条守卫是从 `pnpm audit` 那次教训来的：一个静默产出空结果的安全工具，比没有
 * 这项检查更坏——它让人以为已经查过了。syft 扫错目标时（比如扫 APK）会安安静静
 * 地输出一份 0 组件的合法 CycloneDX 文档。
 */
export const MIN_COMPONENTS = 200;

/** SBOM 只覆盖 JS 依赖；原生那一半的前置条件见文件头。 */
export const COVERAGE = "javascript-only";

/**
 * 丢掉"被扫的那个文件自己"。
 *
 * syft 会把扫描目标也列成一个 `file` 型组件，名字是**绝对路径**
 * （`/home/ubuntu/.../pnpm-lock.yaml`）。绑定产物之后 `metadata.component` 已经
 * 是那个 APK，再留着这一条只会有两个坏处：它没有版本号（SBOM 的意义就是回答
 * "装的是哪个版本"），而且把构建机的目录结构写进了一份会被分发出去的文件。
 *
 * 一并清掉依赖图里指向被删组件的边，免得留下悬空引用。
 */
export function dropScanTargetComponent(document) {
  const components = document.components ?? [];
  const kept = components.filter((item) => item.purl);
  if (kept.length === components.length) return document;
  const removed = new Set(
    components.filter((item) => !item.purl).map((item) => item["bom-ref"]),
  );
  const dependencies = (document.dependencies ?? [])
    .filter((entry) => !removed.has(entry.ref))
    .map((entry) => ({
      ...entry,
      ...(entry.dependsOn
        ? { dependsOn: entry.dependsOn.filter((ref) => !removed.has(ref)) }
        : {}),
    }));
  return { ...document, components: kept, dependencies };
}

/**
 * 把 syft 的输出绑定到具体产物上：谁、哪个版本、哪个 build、哪个文件摘要。
 * 不绑定的 SBOM 只是"某次扫描的结果"，回答不了"用户手机上那个包里有什么"。
 */
export function bindToArtifact(input, artifact) {
  const document = dropScanTargetComponent(input);
  const metadata = { ...(document.metadata ?? {}) };
  metadata.component = {
    type: "application",
    "bom-ref": `${artifact.packageName}@${artifact.version}+${artifact.buildNumber}`,
    name: artifact.packageName,
    version: artifact.version,
    ...(artifact.sha256
      ? { hashes: [{ alg: "SHA-256", content: artifact.sha256 }] }
      : {}),
  };
  metadata.properties = [
    ...(metadata.properties ?? []),
    { name: "rn-app:tenant", value: artifact.tenant },
    { name: "rn-app:buildNumber", value: String(artifact.buildNumber) },
    { name: "rn-app:artifact", value: artifact.fileName },
    // 覆盖范围写进文件里，而不是只写在文档里：拿到这份 SBOM 的人未必读过 runbook
    { name: "rn-app:coverage", value: COVERAGE },
    {
      name: "rn-app:coverage-note",
      value:
        "JavaScript dependencies only (pnpm lockfile). Android native dependencies are NOT covered: this project has no Gradle dependency lock, and the APK ships dex rather than jars.",
    },
    ...(artifact.sourceCommit
      ? [{ name: "rn-app:sourceCommit", value: artifact.sourceCommit }]
      : []),
  ];
  return { ...document, metadata };
}

/** 扫描结果够不够像一次成功的扫描；不够就说清楚是哪里不对。 */
export function assertUsableSbom(document) {
  if (document?.bomFormat !== "CycloneDX")
    throw new Error(`不是 CycloneDX 文档：bomFormat=${document?.bomFormat}`);
  const components = document.components ?? [];
  if (components.length < MIN_COMPONENTS)
    throw new Error(
      `SBOM 只有 ${components.length} 个组件（下限 ${MIN_COMPONENTS}）：这几乎一定是扫错了目标，而不是依赖真的这么少`,
    );
  const missingVersion = components.filter((item) => !item.version);
  if (missingVersion.length > 0)
    throw new Error(
      `${missingVersion.length} 个组件没有版本号，SBOM 回答不了"装的是哪个版本"：${missingVersion
        .slice(0, 5)
        .map((item) => item.name)
        .join(", ")}`,
    );
  return components.length;
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function gitCommit(cwd) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function main(argv) {
  const option = (name) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : null;
  };
  const root = resolve(option("--root") ?? process.cwd());
  const tenantSlug = option("--tenant") ?? process.env.EXPO_PUBLIC_TENANT;
  const apkPath = option("--apk");
  const outPath = option("--out");
  // --input 读一份已经生成好的 syft 输出：脚本因此可以脱离 syft 与网络自测
  const inputPath = option("--input");
  const syftBinary = option("--syft") ?? "syft";

  if (!tenantSlug) {
    console.error("需要 --tenant <slug>（或 EXPO_PUBLIC_TENANT）");
    return 1;
  }
  const tenantFile = resolve(root, "tenants", tenantSlug, "tenant.json");
  if (!existsSync(tenantFile)) {
    console.error(`找不到租户配置：${tenantFile}`);
    return 1;
  }
  const tenant = JSON.parse(readFileSync(tenantFile, "utf8"));

  let raw;
  if (inputPath) {
    raw = readFileSync(inputPath, "utf8");
  } else {
    const lockfile = resolve(root, "pnpm-lock.yaml");
    if (!existsSync(lockfile)) {
      console.error(`找不到 ${lockfile}`);
      return 1;
    }
    const result = spawnSync(
      syftBinary,
      ["scan", `file:${lockfile}`, "-o", "cyclonedx-json", "-q"],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
    if (result.error || result.status !== 0) {
      console.error(
        `syft 跑不起来（${result.error?.message ?? `exit ${result.status}`}）。` +
          `装它：https://github.com/anchore/syft/releases（CI 里按固定版本 + sha256 下载）`,
      );
      if (result.stderr) console.error(result.stderr.slice(0, 2000));
      return 1;
    }
    raw = result.stdout;
  }

  let document;
  try {
    document = JSON.parse(raw);
  } catch {
    console.error("syft 的输出不是合法 JSON；这不代表没有依赖，代表扫描没成功");
    console.error(raw.slice(0, 2000));
    return 1;
  }

  const artifact = {
    tenant: tenantSlug,
    packageName: tenant.androidPackage,
    version: tenant.version,
    buildNumber: tenant.androidVersionCode,
    fileName: apkPath ? apkPath.split("/").pop() : null,
    sha256: apkPath && existsSync(apkPath) ? sha256File(apkPath) : null,
    sourceCommit: gitCommit(root),
  };
  if (apkPath && !artifact.sha256) {
    console.error(`--apk 指向的文件不存在：${apkPath}`);
    return 1;
  }

  const bound = bindToArtifact(document, artifact);
  let count;
  try {
    count = assertUsableSbom(bound);
  } catch (error) {
    console.error(error.message);
    return 1;
  }

  const target =
    outPath ??
    resolve(
      root,
      "artifacts",
      `${tenantSlug}-${tenant.version}-build${tenant.androidVersionCode}-sbom.cdx.json`,
    );
  writeFileSync(target, `${JSON.stringify(bound, null, 2)}\n`);
  console.log(
    `SBOM: ${count} 个组件（${COVERAGE}）→ ${target}` +
      (artifact.sha256
        ? `\n  绑定产物 ${artifact.fileName} sha256 ${artifact.sha256}`
        : ""),
  );
  return 0;
}

// 被当模块 import 时不执行
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exit(main(process.argv.slice(2)));
