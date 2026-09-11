/* global describe, it, expect */

const {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const {
  applyVerificationAction,
  enforcementProblem,
  verificationAction,
  verificationRequested,
} = require("./with-gradle-dependency-verification");

function withTempDir(run) {
  const dir = mkdtempSync(join(tmpdir(), "rn-gradle-verify-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("gradle dependency verification plugin", () => {
  it("only installs the manifest when the switch is explicitly on", () => {
    for (const value of ["1", "true", "yes", "on", "ON"])
      expect(
        verificationRequested({ GRADLE_DEPENDENCY_VERIFICATION: value }),
      ).toBe(true);
    for (const value of [undefined, "", "0", "false", "no", "maybe"])
      expect(
        verificationRequested({ GRADLE_DEPENDENCY_VERIFICATION: value }),
      ).toBe(false);
  });

  it("fails loudly when the switch is on but the manifest is missing", () => {
    // 装不上却安静地继续，等于以为开了校验其实没开
    const action = verificationAction({ requested: true, sourceExists: false });
    expect(action.kind).toBe("fail");
    expect(action.message).toMatch(/android:verification-metadata/);
  });

  it("installs the manifest into the generated android project", () => {
    withTempDir((dir) => {
      const source = join(dir, "verification-metadata.xml");
      const target = join(
        dir,
        "android",
        "gradle",
        "verification-metadata.xml",
      );
      writeFileSync(source, "<verification-metadata/>");
      applyVerificationAction(
        verificationAction({ requested: true, sourceExists: true }),
        { source, target },
      );
      expect(readFileSync(target, "utf8")).toBe("<verification-metadata/>");
    });
  });

  // Gradle 靠"文件在不在"决定要不要校验，没有 lenient 档：上一次装进去的清单
  // 残留下来，会让一个没打算开校验的构建突然开始校验，而且多半是用一份过期清单
  it("removes a stale manifest when the switch is off", () => {
    withTempDir((dir) => {
      const source = join(dir, "verification-metadata.xml");
      const target = join(
        dir,
        "android",
        "gradle",
        "verification-metadata.xml",
      );
      writeFileSync(source, "<verification-metadata/>");
      applyVerificationAction(
        verificationAction({ requested: true, sourceExists: true }),
        { source, target },
      );
      expect(existsSync(target)).toBe(true);

      applyVerificationAction(
        verificationAction({ requested: false, sourceExists: true }),
        { source, target },
      );
      expect(existsSync(target)).toBe(false);
    });
  });

  it("is a no-op rather than an error when the switch is off and nothing was installed", () => {
    withTempDir((dir) => {
      const target = join(
        dir,
        "android",
        "gradle",
        "verification-metadata.xml",
      );
      expect(() =>
        applyVerificationAction(
          verificationAction({ requested: false, sourceExists: false }),
          { source: join(dir, "missing.xml"), target },
        ),
      ).not.toThrow();
    });
  });
});

// CI 是绿的并不说明这条检查跑过：Gradle 的依赖校验成功时一个字都不打。
// 这组用例钉住的是「构建前必须拿到正向证据」，而不是「构建没报错」。
describe("proving the verification actually happens", () => {
  it("refuses to build when prebuild installed no manifest", () => {
    const problem = enforcementProblem({
      installed: false,
      components: 0,
      floor: 1000,
    });
    expect(problem).toMatch(/without checking a single one/);
  });

  it("refuses a truncated manifest instead of enforcing a handful of components", () => {
    expect(
      enforcementProblem({ installed: true, components: 12, floor: 1000 }),
    ).toMatch(/pins only 12 components/);
  });

  it("says nothing is wrong when a full manifest is in place", () => {
    expect(
      enforcementProblem({ installed: true, components: 1313, floor: 1000 }),
    ).toBeNull();
  });
});
