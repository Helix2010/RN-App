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
  it("installs the manifest for every release channel, with no switch to turn it off", () => {
    for (const distributionChannel of ["staging", "store", "direct", "mdm"])
      expect(
        verificationAction({ distributionChannel, sourceExists: true }),
      ).toEqual({ kind: "install" });
  });

  it("has no environment switch left", () => {
    // 以前的 GRADLE_DEPENDENCY_VERIFICATION=0 能把校验关掉；现在环境变量不参与判定
    const previous = process.env.GRADLE_DEPENDENCY_VERIFICATION;
    process.env.GRADLE_DEPENDENCY_VERIFICATION = "0";
    try {
      expect(
        verificationAction({
          distributionChannel: "direct",
          sourceExists: true,
        }),
      ).toEqual({ kind: "install" });
    } finally {
      if (previous === undefined)
        delete process.env.GRADLE_DEPENDENCY_VERIFICATION;
      else process.env.GRADLE_DEPENDENCY_VERIFICATION = previous;
    }
    const source = readFileSync(
      join(process.cwd(), "plugins/with-gradle-dependency-verification.js"),
      "utf8",
    );
    expect(source).not.toMatch(/process\.env|GRADLE_DEPENDENCY_VERIFICATION/);
  });

  it("fails loudly when a release build has no manifest to install", () => {
    // 装不上却安静地继续，等于以为开了校验其实没开
    const action = verificationAction({
      distributionChannel: "direct",
      sourceExists: false,
    });
    expect(action.kind).toBe("fail");
    expect(action.message).toMatch(/android:verification-metadata/);
  });

  it("refuses to guess when the distribution channel is missing or unknown", () => {
    for (const distributionChannel of [undefined, "", "production"])
      expect(
        verificationAction({ distributionChannel, sourceExists: true }).kind,
      ).toBe("fail");
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
        verificationAction({
          distributionChannel: "direct",
          sourceExists: true,
        }),
        { source, target },
      );
      expect(readFileSync(target, "utf8")).toBe("<verification-metadata/>");
    });
  });

  // Gradle 靠"文件在不在"决定要不要校验，没有 lenient 档：上一次正式构建装进去的
  // 清单残留下来，会让开发构建拿一份不对应的清单去校验
  it("removes a stale manifest from a development build", () => {
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
        verificationAction({
          distributionChannel: "direct",
          sourceExists: true,
        }),
        { source, target },
      );
      expect(existsSync(target)).toBe(true);

      applyVerificationAction(
        verificationAction({
          distributionChannel: "development",
          sourceExists: true,
        }),
        { source, target },
      );
      expect(existsSync(target)).toBe(false);
    });
  });

  it("is a no-op rather than an error for a development build with nothing installed", () => {
    withTempDir((dir) => {
      const target = join(
        dir,
        "android",
        "gradle",
        "verification-metadata.xml",
      );
      expect(() =>
        applyVerificationAction(
          verificationAction({
            distributionChannel: "development",
            sourceExists: false,
          }),
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
