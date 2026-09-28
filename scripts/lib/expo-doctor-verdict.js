/**
 * expo-doctor 的输出怎么判（scripts/check-expo-doctor.mjs）。
 *
 * CI 每次用 `pnpm dlx expo-doctor` 跑最新版，它再联网拿 **Expo SDK 当前最新的补丁版本**来比。于是
 * Expo 一发补丁，没人改代码 main 也会变红（2026-09-28 就是：expo 57.0.22 对 57.0.25 等四个包），
 * 而 android-release-gate 依赖这一步通过，发版门禁跟着停。
 *
 * 升级补丁会改原生指纹：之后打的热更新对不上已经装在用户手里的包，要等下一次原生发版才接得上。
 * 所以补丁级的落后只报警告、在日志里列出来，**随下一次原生发版一起升**；次版本、主版本不一致，
 * 以及别的检查失败，照旧判红（2026-09-01 那两个真问题就是大版本不匹配和缺 peer 依赖）。
 *
 * 另一个放行项沿用原来的：Linux 上没有 CocoaPods，原生工具链那一条检查必然失败。
 */

const VERSION_CHECK =
  "Check that packages match versions required by installed Expo SDK";
const TOOLING_CHECK = "Check native tooling versions";

/** 输出里每一条失败检查的名字与它那一段文字（到下一条 ✖ 为止）。 */
function failedChecks(output) {
  const checks = [];
  const lines = output.split("\n");
  let current = null;
  for (const line of lines) {
    const match = /^\s*✖\s+(.+?)\s*$/.exec(line);
    if (match) {
      current = { name: match[1], text: "" };
      checks.push(current);
    } else if (current) {
      current.text += `${line}\n`;
    }
  }
  return checks;
}

/** 补丁级落后的那张表（包名 期望 实际），给警告用。 */
function patchTable(text) {
  const start = text.search(/Patch version mismatches/);
  if (start < 0) return [];
  const rows = [];
  for (const line of text.slice(start).split("\n").slice(1)) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (rows.length > 0) break;
      continue;
    }
    if (/^package\s+expected\s+found/i.test(trimmed)) continue;
    const cells = trimmed.split(/\s+/);
    if (cells.length !== 3) break;
    rows.push(cells.join(" "));
  }
  return rows;
}

/**
 * doctorVerdict 返回 { pass, warnings }。status 是 expo-doctor 的退出码，platform 是 process.platform。
 */
export function doctorVerdict(output, status, platform) {
  if (status === 0) return { pass: true, warnings: [] };
  const failed = failedChecks(output);
  if (failed.length === 0) return { pass: false, warnings: [] };
  const warnings = [];
  for (const check of failed) {
    if (
      check.name.startsWith(TOOLING_CHECK) &&
      platform === "linux" &&
      /CocoaPods version check failed/.test(check.text)
    ) {
      warnings.push(
        "expo-doctor: CocoaPods is unavailable on Linux; native iOS tooling check skipped.",
      );
      continue;
    }
    if (
      check.name.startsWith(VERSION_CHECK) &&
      /Patch version mismatches/.test(check.text) &&
      !/(Major|Minor) version mismatches/i.test(check.text)
    ) {
      const rows = patchTable(check.text);
      warnings.push(
        "expo-doctor: 以下包只落后补丁版本（升级会改原生指纹，随下一次原生发版一起升）：" +
          (rows.length > 0 ? rows.join("；") : "见上方输出"),
      );
      continue;
    }
    return { pass: false, warnings: [] };
  }
  return { pass: true, warnings };
}
