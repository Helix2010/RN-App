const { spawnSync } = require("node:child_process");
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { expect, test } = require("@jest/globals");
const {
  executable,
  fakeAaptScript,
  fakeSdk,
  hasJava,
  realBuildTools,
  syntheticApk,
} = require("./lib/apk-test-fixture");

const script = resolve(process.cwd(), "scripts/build-android-release.mjs");

test("release build refuses to fall back to a local API URL", () => {
  const env = { ...process.env };
  delete env.EXPO_PUBLIC_TENANT;
  delete env.EXPO_PUBLIC_API_BASE_URL;
  const result = spawnSync(process.execPath, [script, "--check-env"], {
    env,
    encoding: "utf8",
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("EXPO_PUBLIC_TENANT is required");
});

test("release build keeps the production tenant configuration together", () => {
  const result = spawnSync(
    process.execPath,
    [script, "anyfun", "--check-env"],
    {
      env: {
        ...process.env,
        EXPO_PUBLIC_API_BASE_URL: "https://wrong-tenant.example",
        EXPO_PUBLIC_APPLICATION_ID: "wrong-tenant",
      },
      encoding: "utf8",
    },
  );
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    tenant: "anyfun",
    apiBaseUrl: "https://api.anyfun.win",
    distributionChannel: "direct",
    otaChannel: "production",
    applicationId: "dex-mobile",
  });
});

test("release build fails fast when the push config file is missing", () => {
  const result = spawnSync(process.execPath, [script, "anyfun"], {
    env: {
      ...process.env,
      ANDROID_HOME: process.cwd(),
      GOOGLE_SERVICES_JSON: resolve(
        process.cwd(),
        "missing-google-services.json",
      ),
    },
    encoding: "utf8",
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(
    "GOOGLE_SERVICES_JSON points to a missing file",
  );
});

test("release build refuses to silently ship without push", () => {
  const result = spawnSync(process.execPath, [script, "anyfun"], {
    env: {
      ...process.env,
      ANDROID_HOME: process.cwd(),
      GOOGLE_SERVICES_JSON: "",
    },
    encoding: "utf8",
  });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("GOOGLE_SERVICES_JSON is required");
});

// ---- 沙箱里跑完整条链路 ---------------------------------------------------
//
// 本机与 CI 都没有能跑 Gradle 的环境，构建机却要靠这个脚本出包，所以脚本行为靠测试钉死：
// 假的 `pnpm`（expo config / prebuild）与 `./gradlew` 只负责把“Gradle 会产出的文件”放到
// 该放的位置，其余全部是脚本自己的真实逻辑——依赖校验的正向证据、产物文件名、
// 没有签名的断言、包名/版本/权限、内嵌配置、复制到 artifacts/。
// 找得到真实 build-tools（ANDROID_HOME 或 RN_TEST_ANDROID_BUILD_TOOLS）时用真的
// apksigner 与 aapt，找不到时用模拟它们输出的脚本。

const anyfunTenant = JSON.parse(
  readFileSync(resolve(process.cwd(), "tenants/anyfun/tenant.json"), "utf8"),
);
// 故意不带 signerSha256：未签名构建不需要它
const tenant = {
  ...anyfunTenant,
  slug: "zz-unsigned",
  scheme: "zzunsigned",
  androidPackage: "com.example.zzunsigned",
  iosBundleId: "com.example.zzunsigned",
};
delete tenant.signerSha256;

const embeddedConfig = {
  extra: {
    apiBaseUrl: tenant.apiBaseUrl,
    distributionChannel: tenant.distributionChannel,
    otaChannel: tenant.otaChannel,
    applicationId: tenant.applicationId,
    appVersion: tenant.version,
    buildNumber: String(tenant.androidVersionCode),
  },
  updates: { enabled: true },
  runtimeVersion: tenant.version,
};

const unsignedApk = (overrides = {}) =>
  syntheticApk({
    packageName: tenant.androidPackage,
    versionCode: tenant.androidVersionCode,
    versionName: tenant.version,
    permissions: [
      "android.permission.INTERNET",
      "android.permission.REQUEST_INSTALL_PACKAGES",
    ],
    appConfig: embeddedConfig,
    ...overrides,
  });

const verificationMetadata = (components) =>
  `<verification-metadata>\n${Array.from(
    { length: components },
    (_, index) => `<component group="g" name="n${index}" version="1"/>\n`,
  ).join("")}</verification-metadata>\n`;

const tools = hasJava() ? realBuildTools() : null;

/**
 * @param options.apk          Gradle 会“产出”的 APK 字节
 * @param options.apkName      产出的文件名（AGP 对未签名 release 用 app-release-unsigned.apk）
 * @param options.installVerificationMetadata  prebuild 是否把依赖校验清单装进 android/
 */
function inSandbox(
  {
    apk = unsignedApk(),
    apkName = "app-release-unsigned.apk",
    installVerificationMetadata = true,
    env = {},
    args = [],
  },
  check,
) {
  const root = mkdtempSync(join(tmpdir(), "rn-release-"));
  try {
    const project = join(root, "project");
    mkdirSync(join(root, "tenants", tenant.slug), { recursive: true });
    mkdirSync(project, { recursive: true });
    writeFileSync(
      join(root, "tenants", tenant.slug, "tenant.json"),
      JSON.stringify(tenant),
    );
    writeFileSync(join(root, "fixture.apk"), apk);
    writeFileSync(
      join(root, "expo-config.json"),
      JSON.stringify({
        version: tenant.version,
        runtimeVersion: tenant.version,
        android: {
          package: tenant.androidPackage,
          versionCode: tenant.androidVersionCode,
        },
      }),
    );
    if (installVerificationMetadata)
      writeFileSync(
        join(root, "installed-metadata.xml"),
        verificationMetadata(1000),
      );
    writeFileSync(
      join(root, "generated-metadata.xml"),
      verificationMetadata(1200),
    );

    executable(
      join(root, "gradlew"),
      [
        `echo "$@" > '${root}/gradlew-args'`,
        `if [ -f gradle/verification-metadata.xml ]; then echo present; else echo absent; fi > '${root}/metadata-at-gradle-time'`,
        'case "$*" in *--write-verification-metadata*)',
        `  cp '${root}/generated-metadata.xml' gradle/verification-metadata.xml ;;`,
        "esac",
        "mkdir -p app/build/outputs/apk/release",
        `cp '${root}/fixture.apk' 'app/build/outputs/apk/release/${apkName}'`,
      ].join("\n"),
    );
    executable(
      join(root, "bin", "pnpm"),
      [
        'case "$*" in',
        `  "exec expo config --json") cat '${root}/expo-config.json' ;;`,
        '  "exec expo prebuild --platform android --clean")',
        "    rm -rf android && mkdir -p android/gradle",
        `    cp '${root}/gradlew' android/gradlew`,
        `    if [ -f '${root}/installed-metadata.xml' ]; then cp '${root}/installed-metadata.xml' android/gradle/verification-metadata.xml; fi ;;`,
        '  *) echo "unexpected pnpm $*" >&2; exit 64 ;;',
        "esac",
      ].join("\n"),
    );
    const sdkRoot = tools
      ? fakeSdk(root, { link: tools })
      : fakeSdk(root, {
          scripts: {
            apksigner:
              'echo "DOES NOT VERIFY"; echo "ERROR: Missing META-INF/MANIFEST.MF"; exit 1',
            aapt: fakeAaptScript({
              packageName: tenant.androidPackage,
              versionCode: tenant.androidVersionCode,
              versionName: tenant.version,
            }),
          },
        });

    const childEnv = {
      ...process.env,
      PATH: `${join(root, "bin")}:${process.env.PATH}`,
      RN_TENANTS_ROOT: join(root, "tenants"),
      // 临时目录里没有 .env.local：不受开发者本机机器配置影响
      RN_ENV_ROOT: root,
      ANDROID_HOME: sdkRoot,
      GOOGLE_SERVICES_JSON: "",
      ...env,
    };
    for (const key of [
      "ANDROID_SDK_ROOT",
      "EXPO_PUBLIC_TENANT",
      "EXPO_REQUIRE_OTA_SIGNING",
      "EXPO_UPDATES_CODE_SIGNING_CERTIFICATE",
    ])
      if (!(key in env)) delete childEnv[key];
    const result = spawnSync(
      process.execPath,
      [script, tenant.slug, "--no-push", ...args],
      { cwd: project, env: childEnv, encoding: "utf8" },
    );
    const read = (path) =>
      existsSync(path) ? readFileSync(path, "utf8").trim() : null;
    return check({
      result,
      project,
      artifact: join(
        project,
        "artifacts",
        `${tenant.slug}-${tenant.version}-build${tenant.androidVersionCode}-release-unsigned.apk`,
      ),
      gradleArgs: read(join(root, "gradlew-args")),
      metadataAtGradleTime: read(join(root, "metadata-at-gradle-time")),
      fixture: join(root, "fixture.apk"),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("release build outputs the unsigned APK without signerSha256 or any signing material", () => {
  inSandbox({}, ({ result, artifact, fixture, gradleArgs }) => {
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(gradleArgs).toBe("assembleRelease");
    // 产物路径：AGP 的 app-release-unsigned.apk → artifacts/<slug>-<version>-build<code>-release-unsigned.apk
    expect(readFileSync(artifact)).toEqual(readFileSync(fixture));
    expect(result.stdout).toContain(
      `Android unsigned release APK: ${artifact}`,
    );
    expect(result.stdout).toContain("no signature");
    expect(`${result.stdout}${result.stderr}`).not.toMatch(
      /signerSha256|ANDROID_RELEASE_|keystore/i,
    );
  });
}, 60000);

test("release build rejects a signed APK even when Gradle names it -unsigned", () => {
  inSandbox(
    { apk: unsignedApk({ signingBlock: true }) },
    ({ result, artifact }) => {
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(
        /already signed[\s\S]*only the signing gate signs/,
      );
      expect(existsSync(artifact)).toBe(false);
    },
  );
}, 60000);

test("release build rejects a signed app-release.apk from an injected signing config", () => {
  inSandbox({ apkName: "app-release.apk" }, ({ result, project }) => {
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "Gradle wrote a signed app-release.apk instead of app-release-unsigned.apk",
    );
    expect(existsSync(join(project, "artifacts"))).toBe(false);
  });
}, 60000);

test("release build checks the embedded config inside the APK itself", () => {
  inSandbox(
    {
      apk: unsignedApk({
        appConfig: {
          ...embeddedConfig,
          extra: {
            ...embeddedConfig.extra,
            apiBaseUrl: "http://localhost:3000",
          },
        },
      }),
    },
    ({ result, artifact }) => {
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        `embedded app.config apiBaseUrl: expected ${tenant.apiBaseUrl}, received http://localhost:3000`,
      );
      expect(existsSync(artifact)).toBe(false);
    },
  );
}, 60000);

// 依赖校验在 release 构建里强制开启：没有开关，旧的 GRADLE_DEPENDENCY_VERIFICATION=0 也关不掉
test("release build enforces Gradle dependency verification with no switch to turn it off", () => {
  inSandbox(
    {
      installVerificationMetadata: false,
      env: { GRADLE_DEPENDENCY_VERIFICATION: "0" },
    },
    ({ result, gradleArgs }) => {
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("without checking a single one");
      // 在跑 Gradle 之前就停下
      expect(gradleArgs).toBeNull();
    },
  );
  inSandbox({}, ({ result, metadataAtGradleTime }) => {
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "Gradle dependency verification: enforcing 1000 pinned components",
    );
    expect(metadataAtGradleTime).toBe("present");
  });
}, 60000);

test("regenerating the verification metadata drops the installed manifest before Gradle runs", () => {
  inSandbox(
    { args: ["--write-verification-metadata"] },
    ({ result, project, gradleArgs, metadataAtGradleTime }) => {
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(gradleArgs).toBe(
        "--write-verification-metadata sha256 assembleRelease",
      );
      expect(metadataAtGradleTime).toBe("absent");
      expect(
        readFileSync(join(project, "gradle/verification-metadata.xml"), "utf8"),
      ).toBe(verificationMetadata(1200));
    },
  );
}, 60000);

test("release build refuses to ship without an OTA trust root once the switch is on", () => {
  inSandbox(
    {
      env: {
        EXPO_REQUIRE_OTA_SIGNING: "1",
        EXPO_UPDATES_CODE_SIGNING_CERTIFICATE: "",
      },
    },
    ({ result, gradleArgs }) => {
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("EXPO_REQUIRE_OTA_SIGNING is on");
      expect(gradleArgs).toBeNull();
    },
  );
}, 60000);
