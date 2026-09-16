const { spawnSync } = require("node:child_process");
const {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { describe, expect, test } = require("@jest/globals");
const {
  executable,
  fakeAaptScript,
  fakeSdk,
  hasJava,
  realBuildTools,
  syntheticApk,
} = require("./lib/apk-test-fixture");

const script = resolve(process.cwd(), "scripts/android-dev-signed.mjs");
const developmentPackage = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "tenants/development-identity.json"),
    "utf8",
  ),
).androidPackage;
const tenantPackages = readdirSync(resolve(process.cwd(), "tenants"), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map(
    (entry) =>
      JSON.parse(
        readFileSync(
          resolve(process.cwd(), "tenants", entry.name, "tenant.json"),
          "utf8",
        ),
      ).androidPackage,
  );

const APKSIGNER_DOES_NOT_VERIFY =
  'echo "DOES NOT VERIFY"; echo "ERROR: Missing META-INF/MANIFEST.MF"; exit 1';

function withSandbox(run) {
  const root = mkdtempSync(join(tmpdir(), "rn-dev-signed-"));
  try {
    const project = join(root, "project");
    mkdirSync(project, { recursive: true });
    return run({ root, project, keysDir: join(root, "keys") });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function devSigned({ project, keysDir, sdkRoot, env = {} }, args) {
  const childEnv = {
    ...process.env,
    RN_TEST_KEYS_DIR: keysDir,
    ANDROID_HOME: sdkRoot ?? join(project, "no-sdk"),
    ...env,
  };
  for (const key of ["ANDROID_SDK_ROOT", "EXPO_PUBLIC_TENANT", "JAVA_HOME"])
    if (!(key in env)) delete childEnv[key];
  return spawnSync(process.execPath, [script, ...args], {
    cwd: project,
    env: childEnv,
    encoding: "utf8",
  });
}

/** 假的 SDK：apksigner 报“验证不通过”，aapt 报给定的包名 */
function fakeToolsFor(root, packageName) {
  return fakeSdk(root, {
    scripts: {
      apksigner: APKSIGNER_DOES_NOT_VERIFY,
      aapt: fakeAaptScript({ packageName, versionName: "1.0.0" }),
    },
  });
}

describe("android:dev-signed refuses formal packages", () => {
  test("refuses to sign any tenant package name, before touching the test key", () => {
    expect(tenantPackages.length).toBeGreaterThan(0);
    for (const packageName of tenantPackages)
      withSandbox(({ root, project, keysDir }) => {
        const apk = join(project, "tenant-unsigned.apk");
        writeFileSync(apk, syntheticApk({ packageName }));
        const result = devSigned(
          { project, keysDir, sdkRoot: fakeToolsFor(root, packageName) },
          ["--apk", apk],
        );
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(
          `Refusing to sign ${packageName}: android:dev-signed only signs the development package ${developmentPackage}`,
        );
        expect(result.stderr).toContain("signed only by the signing gate");
        // 没有测试密钥也是先报包名：拒绝发生在碰密钥之前
        expect(result.stderr).not.toContain("No test key");
        expect(existsSync(join(project, "artifacts"))).toBe(false);
      });
  });

  test("refuses an APK that is already signed", () => {
    withSandbox(({ root, project, keysDir }) => {
      const apk = join(project, "signed.apk");
      writeFileSync(
        apk,
        syntheticApk({ packageName: developmentPackage, signingBlock: true }),
      );
      const result = devSigned(
        { project, keysDir, sdkRoot: fakeToolsFor(root, developmentPackage) },
        ["--apk", apk],
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("already signed");
    });
  });

  test("refuses to build while EXPO_PUBLIC_TENANT selects a tenant", () => {
    withSandbox(({ project, keysDir }) => {
      const result = devSigned(
        { project, keysDir, env: { EXPO_PUBLIC_TENANT: "anyfun" } },
        [],
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("unset EXPO_PUBLIC_TENANT (anyfun)");
    });
  });

  // .env.local 里的 EXPO_PUBLIC_TENANT 进程环境看不到，Expo 自己会读：以解析后的配置为准
  test("refuses to build when the resolved Expo config is a tenant package", () => {
    withSandbox(({ root, project, keysDir }) => {
      mkdirSync(keysDir, { mode: 0o700 });
      for (const [file, mode] of [
        ["android-dev-test.p12", 0o600],
        ["android-dev-test.password", 0o600],
      ]) {
        writeFileSync(join(keysDir, file), "placeholder", { mode });
        chmodSync(join(keysDir, file), mode);
      }
      executable(
        join(root, "bin", "pnpm"),
        `case "$*" in "exec expo config --json") echo '{"android":{"package":"${tenantPackages[0]}"}}' ;; *) echo "unexpected pnpm $*" >&2; exit 64 ;; esac`,
      );
      const result = devSigned(
        {
          project,
          keysDir,
          sdkRoot: fakeToolsFor(root, developmentPackage),
          env: { PATH: `${join(root, "bin")}:${process.env.PATH}` },
        },
        [],
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`Refusing to sign ${tenantPackages[0]}`);
      expect(result.stderr).not.toContain("unexpected pnpm");
    });
  });

  test("refuses to put the test key inside the repository", () => {
    withSandbox(({ project }) => {
      const result = devSigned({ project, keysDir: join(project, "keys") }, [
        "keygen",
      ]);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("inside the repository");
      expect(existsSync(join(project, "keys"))).toBe(false);
    });
  });

  test("rejects a relative RN_TEST_KEYS_DIR and unknown arguments", () => {
    withSandbox(({ project }) => {
      const relative = devSigned({ project, keysDir: "keys" }, ["keygen"]);
      expect(relative.status).not.toBe(0);
      expect(relative.stderr).toContain(
        "RN_TEST_KEYS_DIR must be an absolute path",
      );
      const unknown = devSigned({ project, keysDir: join(project, "..") }, [
        "sign-everything",
      ]);
      expect(unknown.status).toBe(2);
      expect(unknown.stderr).toContain("Usage:");
    });
  });
});

const tools = hasJava() ? realBuildTools() : null;
const describeWithJava = hasJava() ? describe : describe.skip;
const describeWithRealTools = tools ? describe : describe.skip;

describeWithJava("android:dev-signed keygen", () => {
  test("writes a 0600 password file, never prints the password, and refuses to overwrite", () => {
    withSandbox(({ project, keysDir }) => {
      const first = devSigned({ project, keysDir }, ["keygen"]);
      expect(first.stderr).toBe("");
      expect(first.status).toBe(0);
      const passwordFile = join(keysDir, "android-dev-test.password");
      const password = readFileSync(passwordFile, "utf8");
      expect(password.length).toBeGreaterThanOrEqual(40);
      expect(statSync(passwordFile).mode & 0o777).toBe(0o600);
      expect(statSync(join(keysDir, "android-dev-test.p12")).mode & 0o777).toBe(
        0o600,
      );
      expect(statSync(keysDir).mode & 0o777).toBe(0o700);
      expect(first.stdout).not.toContain(password);
      expect(first.stdout).toMatch(/Certificate SHA-256: [0-9a-f]{64}/);

      const second = devSigned({ project, keysDir }, ["keygen"]);
      expect(second.status).not.toBe(0);
      expect(second.stderr).toContain("already holds a test key");
      expect(readFileSync(passwordFile, "utf8")).toBe(password);
    });
  }, 60000);
});

describeWithRealTools(
  "android:dev-signed signs the development package",
  () => {
    test("signs with the local test key and nothing else", () => {
      withSandbox(({ root, project, keysDir }) => {
        const keygen = devSigned({ project, keysDir }, ["keygen"]);
        expect(keygen.status).toBe(0);
        const certificate = /Certificate SHA-256: ([0-9a-f]{64})/.exec(
          keygen.stdout,
        )[1];

        const apk = join(project, "app-release-unsigned.apk");
        writeFileSync(
          apk,
          syntheticApk({
            packageName: developmentPackage,
            versionCode: 1,
            versionName: "0.0.0-dev",
          }),
        );
        const sdkRoot = fakeSdk(root, { link: tools });
        const result = devSigned({ project, keysDir, sdkRoot }, ["--apk", apk]);
        expect(result.stderr).toBe("");
        expect(result.status).toBe(0);
        const password = readFileSync(
          join(keysDir, "android-dev-test.password"),
          "utf8",
        );
        expect(result.stdout).not.toContain(password);

        const artifact = join(
          project,
          "artifacts",
          `${developmentPackage}-0.0.0-dev-build1-test-signed.apk`,
        );
        expect(result.stdout).toContain(artifact);
        const verify = spawnSync(
          join(tools, "apksigner"),
          ["verify", "--print-certs", artifact],
          { encoding: "utf8" },
        );
        expect(verify.status).toBe(0);
        expect(verify.stdout).toContain(
          `certificate SHA-256 digest: ${certificate}`,
        );
        expect(existsSync(`${artifact}.idsig`)).toBe(false);
      });
    }, 60000);

    // 检查与签名之间原路径上的文件可能被换掉：脚本只对私有临时目录里的副本操作，
    // 签完还要再核一次包名
    test("works on a private copy and re-checks the package name after signing", () => {
      withSandbox(({ root, project, keysDir }) => {
        expect(devSigned({ project, keysDir }, ["keygen"]).status).toBe(0);
        const apk = join(project, "app-release-unsigned.apk");
        writeFileSync(apk, syntheticApk({ packageName: developmentPackage }));
        const log = join(root, "aapt-calls");
        const wrapped = (swapAfterFirstCall) =>
          fakeSdk(join(root, swapAfterFirstCall ? "swap" : "log"), {
            link: tools,
            scripts: {
              aapt: [
                `echo "$3" >> '${log}'`,
                ...(swapAfterFirstCall
                  ? [
                      `if [ "$(wc -l < '${log}')" -gt 1 ]; then echo "package: name='${tenantPackages[0]}' versionCode='1' versionName='0.0.0-dev'"; exit 0; fi`,
                    ]
                  : []),
                `exec '${join(tools, "aapt")}' "$@"`,
              ].join("\n"),
            },
          });

        const ok = devSigned({ project, keysDir, sdkRoot: wrapped(false) }, [
          "--apk",
          apk,
        ]);
        expect(ok.stderr).toBe("");
        expect(ok.status).toBe(0);
        const inspected = readFileSync(log, "utf8").trim().split("\n");
        expect(inspected).toHaveLength(2);
        for (const path of inspected) {
          expect(path).not.toBe(apk);
          expect(path.startsWith(join(tmpdir(), "rn-dev-signed-"))).toBe(true);
        }

        rmSync(join(project, "artifacts"), { recursive: true, force: true });
        rmSync(log);
        const swapped = devSigned(
          { project, keysDir, sdkRoot: wrapped(true) },
          ["--apk", apk],
        );
        expect(swapped.status).not.toBe(0);
        expect(swapped.stderr).toContain(
          `Refusing to sign ${tenantPackages[0]}`,
        );
        expect(existsSync(join(project, "artifacts"))).toBe(false);
      });
    }, 60000);

    test("refuses to sign with a key directory other users can read", () => {
      withSandbox(({ root, project, keysDir }) => {
        expect(devSigned({ project, keysDir }, ["keygen"]).status).toBe(0);
        chmodSync(join(keysDir, "android-dev-test.password"), 0o644);
        const apk = join(project, "app-release-unsigned.apk");
        writeFileSync(apk, syntheticApk({ packageName: developmentPackage }));
        const result = devSigned(
          { project, keysDir, sdkRoot: fakeSdk(root, { link: tools }) },
          ["--apk", apk],
        );
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("readable by other users");
        expect(existsSync(join(project, "artifacts"))).toBe(false);
      });
    }, 60000);
  },
);
