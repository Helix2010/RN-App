const { expect, test } = require("@jest/globals");
const { doctorVerdict } = require("./expo-doctor-verdict.js");

// 2026-09-28 CI 上的真实输出（节选）：只有补丁级落后
const patchOnly = `Running 21 checks on your project...
20/21 checks passed. 1 checks failed. Possible issues detected:

✖ Check that packages match versions required by installed Expo SDK

🔧 Patch version mismatches
package             expected  found
expo                ~57.0.25  57.0.22
expo-constants      ~57.0.19  57.0.18
expo-notifications  ~57.0.21  57.0.18
expo-updates        ~57.0.23  57.0.22

4 packages out of date.
Advice:
Use 'npx expo install --check' to review and upgrade your dependencies.
1 check failed, indicating possible issues with the project.
`;

test("全部通过时直接通过", () => {
  expect(doctorVerdict("21/21 checks passed.", 0, "linux")).toEqual({
    pass: true,
    warnings: [],
  });
});

test("只落后补丁版本时通过，并把落后的包列进警告", () => {
  const verdict = doctorVerdict(patchOnly, 1, "linux");
  expect(verdict.pass).toBe(true);
  expect(verdict.warnings).toHaveLength(1);
  expect(verdict.warnings[0]).toContain("expo ~57.0.25 57.0.22");
  expect(verdict.warnings[0]).toContain("expo-updates ~57.0.23 57.0.22");
});

// 2026-09-01 那次抓到的就是大版本不匹配：这种必须照旧判红
test("次版本或主版本不一致照旧失败", () => {
  const major = patchOnly.replace(
    "🔧 Patch version mismatches",
    "🔧 Major version mismatches\npackage expected found\nreact-native-get-random-values ~1.11.0 2.0.0\n\n🔧 Patch version mismatches",
  );
  expect(doctorVerdict(major, 1, "linux").pass).toBe(false);
  const minor = patchOnly.replace(
    "Patch version mismatches",
    "Minor version mismatches",
  );
  expect(doctorVerdict(minor, 1, "linux").pass).toBe(false);
});

test("别的检查失败照旧失败，哪怕同时只有补丁级落后", () => {
  const other = `${patchOnly}
✖ Check for app config fields that may not be synced in a non-CNG project
Some fields are not synced.
`;
  expect(doctorVerdict(other, 1, "linux").pass).toBe(false);
});

test("Linux 上只有 CocoaPods 那条失败时放行（原有规则），macOS 上不放行", () => {
  const cocoapods = `✖ Check native tooling versions
CocoaPods version check failed. CocoaPods may not be installed.
`;
  expect(doctorVerdict(cocoapods, 1, "linux").pass).toBe(true);
  expect(doctorVerdict(cocoapods, 1, "darwin").pass).toBe(false);
  // 两条放行项同时出现也放行
  expect(doctorVerdict(`${patchOnly}${cocoapods}`, 1, "linux").pass).toBe(true);
});

test("退出码非零但读不出失败项时失败（输出格式变了就别猜）", () => {
  expect(doctorVerdict("something unexpected", 1, "linux").pass).toBe(false);
});
