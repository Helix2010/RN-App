const { spawnSync } = require("node:child_process");
const {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { expect, test } = require("@jest/globals");

const script = resolve(process.cwd(), "scripts/build-sbom.mjs");
const anyfun = JSON.parse(
  readFileSync(resolve(process.cwd(), "tenants/anyfun/tenant.json"), "utf8"),
);

/** syft 扫 pnpm-lock.yaml 的输出形状：npm 组件 + 被扫文件自己那一条 */
function syftOutput({
  packages = 300,
  scanTarget = true,
  dropVersion = false,
} = {}) {
  const components = Array.from({ length: packages }, (_, index) => ({
    "bom-ref": `ref-${index}`,
    type: "library",
    name: `pkg-${index}`,
    ...(dropVersion && index === 7 ? {} : { version: `1.0.${index}` }),
    purl: `pkg:npm/pkg-${index}@1.0.${index}`,
  }));
  if (scanTarget)
    components.push({
      "bom-ref": "scan-target",
      type: "file",
      // syft 写的是绝对路径：这条如果留在 SBOM 里，构建机目录就跟着文件发出去了
      name: "/home/someone/secret-checkout/pnpm-lock.yaml",
    });
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.7",
    metadata: { timestamp: "2026-09-11T00:00:00Z", component: { name: "x" } },
    components,
    dependencies: [
      { ref: "ref-0", dependsOn: ["ref-1", "scan-target"] },
      { ref: "scan-target", dependsOn: ["ref-0"] },
    ],
  };
}

function run(report, extraArgs = []) {
  const dir = mkdtempSync(join(tmpdir(), "rn-sbom-"));
  try {
    mkdirSync(join(dir, "tenants", "anyfun"), { recursive: true });
    writeFileSync(
      join(dir, "tenants", "anyfun", "tenant.json"),
      JSON.stringify(anyfun),
    );
    mkdirSync(join(dir, "artifacts"), { recursive: true });
    const input = join(dir, "syft.json");
    writeFileSync(input, JSON.stringify(report));
    const out = join(dir, "sbom.json");
    const result = spawnSync(
      process.execPath,
      [
        script,
        "--root",
        dir,
        "--tenant",
        "anyfun",
        "--input",
        input,
        "--out",
        out,
        ...extraArgs,
      ],
      { encoding: "utf8" },
    );
    return {
      ...result,
      sbom: result.status === 0 ? JSON.parse(readFileSync(out, "utf8")) : null,
      dir,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("binds the bill of materials to the artifact it describes", () => {
  const { status, sbom } = run(syftOutput());
  expect(status).toBe(0);
  // 不绑定的 SBOM 只是"某次扫描的结果"，回答不了"用户手机上那个包里有什么"
  expect(sbom.metadata.component).toMatchObject({
    type: "application",
    name: anyfun.androidPackage,
    version: anyfun.version,
  });
  const properties = Object.fromEntries(
    sbom.metadata.properties.map((item) => [item.name, item.value]),
  );
  expect(properties["rn-app:tenant"]).toBe("anyfun");
  expect(properties["rn-app:buildNumber"]).toBe(
    String(anyfun.androidVersionCode),
  );
});

test("states in the file itself that the native half is not covered", () => {
  // 拿到这份 SBOM 的人未必读过 runbook；把覆盖范围只写在文档里等于没写
  const { sbom } = run(syftOutput());
  const properties = Object.fromEntries(
    sbom.metadata.properties.map((item) => [item.name, item.value]),
  );
  expect(properties["rn-app:coverage"]).toBe("javascript-only");
  expect(properties["rn-app:coverage-note"]).toMatch(/native/i);
});

test("drops the scan target so no build-machine path ships with the file", () => {
  const { sbom } = run(syftOutput());
  const serialized = JSON.stringify(sbom);
  expect(serialized).not.toContain("/home/someone/secret-checkout");
  expect(sbom.components.every((item) => item.purl)).toBe(true);
  // 依赖图里指向被删组件的边一并清掉，不留悬空引用
  expect(sbom.dependencies.map((entry) => entry.ref)).not.toContain(
    "scan-target",
  );
  expect(sbom.dependencies[0].dependsOn).toEqual(["ref-1"]);
});

// 这不是假设：syft 扫 Android APK 时就是安安静静输出一份 0 组件的合法 CycloneDX
// 文档（代码在 classes.dex 里，没有 dex 编目器）。静默产出空结果的安全工具，
// 比没有这项检查更坏——它让人以为已经查过了。
test("refuses an implausibly small result instead of shipping an empty bill", () => {
  const { status, stderr } = run(syftOutput({ packages: 3 }));
  expect(status).not.toBe(0);
  expect(stderr).toMatch(/扫错了目标/);
});

test("refuses a component without a version", () => {
  const { status, stderr } = run(syftOutput({ dropVersion: true }));
  expect(status).not.toBe(0);
  expect(stderr).toMatch(/没有版本号/);
});

test("refuses anything that is not a CycloneDX document", () => {
  const { status, stderr } = run({ hello: "world" });
  expect(status).not.toBe(0);
  expect(stderr).toMatch(/不是 CycloneDX/);
});

test("refuses an --apk path that does not exist", () => {
  const { status, stderr } = run(syftOutput(), ["--apk", "/nonexistent.apk"]);
  expect(status).not.toBe(0);
  expect(stderr).toMatch(/不存在/);
});
