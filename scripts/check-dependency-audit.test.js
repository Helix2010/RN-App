const { spawnSync } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { expect, test } = require("@jest/globals");

const script = resolve(process.cwd(), "scripts/check-dependency-audit.mjs");

/** 用一份抓好的 audit 输出跑脚本：不碰网络，结果可复现 */
function runWith(report, args = []) {
  const dir = mkdtempSync(join(tmpdir(), "rn-audit-"));
  try {
    const path = join(dir, "audit.json");
    writeFileSync(
      path,
      typeof report === "string" ? report : JSON.stringify(report),
    );
    return spawnSync(process.execPath, [script, "--input", path, ...args], {
      encoding: "utf8",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const REPORT = {
  advisories: {
    1: {
      severity: "high",
      module_name: "@xmldom/xmldom",
      title: "xmldom: output amplification",
      findings: [{ paths: [".>expo>@expo/cli>@expo/plist>@xmldom/xmldom"] }],
    },
    2: {
      severity: "high",
      module_name: "@xmldom/xmldom",
      title: "xmldom: QName validation bypass",
      findings: [{ paths: [".>expo>@expo/cli>@expo/plist>@xmldom/xmldom"] }],
    },
    3: {
      severity: "moderate",
      module_name: "uuid",
      title: "uuid: missing bounds check",
      findings: [{ paths: [".>expo>@expo/config-plugins>xcode>uuid"] }],
    },
  },
};

test("reports every advisory and groups repeats of the same package", () => {
  const result = runWith(REPORT);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("3 条公告");
  expect(result.stdout).toContain("high 2");
  expect(result.stdout).toContain("moderate 1");
  // 同一个包的多条公告合成一行，否则真正的新增会被淹掉。
  // 只数"严重度 + 模块"那一列，引入路径里也会出现同一个包名
  const moduleRows = result.stdout
    .split("\n")
    .filter((line) => /^\s+(high|moderate|low|critical|info)\s+\S/.test(line));
  expect(moduleRows).toHaveLength(2);
  expect(
    moduleRows.filter((line) => line.includes("@xmldom/xmldom")),
  ).toHaveLength(1);
  // 带上引入路径，才知道是从哪个直接依赖来的
  expect(result.stdout).toContain(".>expo>@expo/cli");
});

test("stays green in report mode even with high severity findings", () => {
  expect(runWith(REPORT).status).toBe(0);
});

test("blocks once a threshold is given", () => {
  expect(runWith(REPORT, ["--fail-on", "high"]).status).not.toBe(0);
  expect(runWith(REPORT, ["--fail-on", "critical"]).status).toBe(0);
});

test("says so when there is nothing to report", () => {
  const result = runWith({ advisories: {} });
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("没有已知漏洞");
});

// 评审里记过"本次 pnpm audit 未成功"，而那次失败是静默的：CI 绿着，没人知道
// 这项检查其实没跑。跑不起来的安全检查比没有更坏。
test("fails loudly when the audit could not run, instead of reading as clean", () => {
  const result = runWith("not json at all");
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("这项检查没跑起来");
});

test("fails when the input file is missing", () => {
  const result = spawnSync(
    process.execPath,
    [script, "--input", "/nonexistent/audit.json"],
    { encoding: "utf8" },
  );
  expect(result.status).not.toBe(0);
});
