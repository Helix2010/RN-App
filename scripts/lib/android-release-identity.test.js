/* global describe, it, expect */

const { existsSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const {
  DEBUG_SIGNER_SHA256,
  assertApkUnsigned,
  assertReleaseIdentity,
  embeddedConfigProblems,
  parseBadging,
  parseSignerDigests,
  readEmbeddedAppConfig,
  signatureEvidence,
  verifyUnsignedReleaseApk,
} = require("./android-release-identity");
const {
  fakeAaptScript,
  fakeSdk,
  hasJava,
  realBuildTools,
  signWithFreshKey,
  syntheticApk,
} = require("./apk-test-fixture");

// 取自 apksigner 36.0.0 对 artifacts/anyfun-1.2.11-build25-release.apk 的真实输出
const APKSIGNER_DEBUG = `Signer #1 certificate DN: CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US
Signer #1 certificate SHA-256 digest: fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c
Signer #1 certificate SHA-1 digest: 5e8f16062ea3cd2c4a0d547876baa6f38cabf625
Signer #1 certificate MD5 digest: 20f46148b72d8e5e5ca23d37a4f41490
`;
const PROD_SIGNER =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const APKSIGNER_PROD = `Signer #1 certificate DN: CN=AnyFun Release
Signer #1 certificate SHA-256 digest: ${PROD_SIGNER.toUpperCase()}
Signer #1 certificate SHA-1 digest: 5e8f16062ea3cd2c4a0d547876baa6f38cabf625
`;
const BADGING = `package: name='com.anyfun.foundation' versionCode='25' versionName='1.2.11' platformBuildVersionName='16' platformBuildVersionCode='36' compileSdkVersion='36' compileSdkVersionCodename='16'
sdkVersion:'24'
targetSdkVersion:'36'
uses-permission: name='android.permission.CAMERA'
uses-permission: name='android.permission.INTERNET'
uses-permission: name='android.permission.REQUEST_INSTALL_PACKAGES'
uses-permission: name='android.permission.SYSTEM_ALERT_WINDOW'
uses-permission: name='android.permission.READ_EXTERNAL_STORAGE' maxSdkVersion='32'
uses-permission: name='android.permission.INTERNET'
uses-permission-sdk-23: name='android.permission.ACCESS_MEDIA_LOCATION'
`;
// 只含真实产物里出现过、且在允许列表上的权限；各用例在它上面加自己要试的那一条
const CLEAN_BADGING = `package: name='com.anyfun.foundation' versionCode='25' versionName='1.2.11' platformBuildVersionName='16' platformBuildVersionCode='36' compileSdkVersion='36' compileSdkVersionCodename='16'
sdkVersion:'24'
targetSdkVersion:'36'
uses-permission: name='android.permission.CAMERA'
uses-permission: name='android.permission.INTERNET'
uses-permission: name='android.permission.READ_EXTERNAL_STORAGE' maxSdkVersion='32'
uses-permission: name='android.permission.USE_BIOMETRIC'
`;
// APK Signature Scheme v3.1 轮换后 apksigner 会打印多组签名者
const APKSIGNER_ROTATED = `Signer #1 certificate DN: CN=AnyFun Release
Signer #1 certificate SHA-256 digest: ${PROD_SIGNER}
Signer (minSdkVersion=28, maxSdkVersion=2147483647) certificate DN: CN=AnyFun Release v2
Signer (minSdkVersion=28, maxSdkVersion=2147483647) certificate SHA-256 digest: ${"9".repeat(64)}
`;
const tenant = {
  androidPackage: "com.anyfun.foundation",
  androidVersionCode: 25,
  version: "1.2.11",
  signerSha256: PROD_SIGNER,
  distributionChannel: "direct",
};

describe("android release identity", () => {
  it("parses signer digests (deduplicated, lowercased) and badging", () => {
    expect(parseSignerDigests(APKSIGNER_DEBUG)).toEqual([DEBUG_SIGNER_SHA256]);
    expect(parseSignerDigests(APKSIGNER_PROD)).toEqual([PROD_SIGNER]);
    expect(parseBadging(BADGING)).toEqual({
      packageName: "com.anyfun.foundation",
      versionCode: 25,
      versionName: "1.2.11",
      permissions: [
        "android.permission.ACCESS_MEDIA_LOCATION",
        "android.permission.CAMERA",
        "android.permission.INTERNET",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.REQUEST_INSTALL_PACKAGES",
        "android.permission.SYSTEM_ALERT_WINDOW",
      ],
    });
  });

  it("rejects a v3.1 key-rotation chain: the direct channel accepts exactly one production signer", () => {
    expect(parseSignerDigests(APKSIGNER_ROTATED)).toHaveLength(2);
    expect(() =>
      assertReleaseIdentity({
        signers: parseSignerDigests(APKSIGNER_ROTATED),
        badging: parseBadging(
          BADGING.replace(
            /^uses-permission: name='android.permission.SYSTEM_ALERT_WINDOW'\n/m,
            "",
          ),
        ),
        tenant,
      }),
    ).toThrow(/exactly one signer certificate, found 2/);
  });

  it("rejects the current debug-signed artifact for every reason at once", () => {
    expect(() =>
      assertReleaseIdentity({
        signers: parseSignerDigests(APKSIGNER_DEBUG),
        badging: parseBadging(BADGING),
        tenant,
      }),
    ).toThrow(
      /public React Native debug keystore[\s\S]*does not match tenant.json signerSha256[\s\S]*forbidden permission declared: android.permission.SYSTEM_ALERT_WINDOW/,
    );
  });

  it("rejects a tenant without a pinned production signer even when the APK is not debug-signed", () => {
    expect(() =>
      assertReleaseIdentity({
        signers: [PROD_SIGNER],
        badging: parseBadging(
          BADGING.replace(
            /^uses-permission: name='android.permission.SYSTEM_ALERT_WINDOW'\n/m,
            "",
          ),
        ),
        tenant: { ...tenant, signerSha256: undefined },
      }),
    ).toThrow(/signerSha256 must be the production certificate SHA-256/);
  });

  it("rejects package, version and multiple-signer mismatches", () => {
    const badging = parseBadging(
      BADGING.replace(
        /^uses-permission: name='android.permission.SYSTEM_ALERT_WINDOW'\n/m,
        "",
      ),
    );
    expect(() =>
      assertReleaseIdentity({
        signers: [PROD_SIGNER],
        badging: { ...badging, packageName: "com.other.app", versionCode: 26 },
        tenant,
      }),
    ).toThrow(/package com.other.app[\s\S]*versionCode 26/);
    expect(() =>
      assertReleaseIdentity({
        signers: [PROD_SIGNER, DEBUG_SIGNER_SHA256],
        badging,
        tenant,
      }),
    ).toThrow(/exactly one signer/);
  });

  it("passes a production-signed APK whose identity matches the tenant", () => {
    const badging = parseBadging(CLEAN_BADGING);
    expect(
      assertReleaseIdentity({ signers: [PROD_SIGNER], badging, tenant }),
    ).toMatchObject({
      signer: PROD_SIGNER,
      packageName: "com.anyfun.foundation",
    });
  });

  // 禁用列表只认得我们已经想到的那几个。真正危险的是**新冒出来**的权限：
  // 某个依赖升级顺手加了录音或定位，禁用列表永远不会提到它。
  it("rejects a permission a dependency slipped in, including via uses-permission-sdk-23", () => {
    for (const line of [
      "uses-permission: name='android.permission.RECORD_AUDIO'",
      "uses-permission: name='android.permission.ACCESS_FINE_LOCATION'",
      // sdk-23 声明同样是清单的一部分，不能成为绕过允许列表的后门
      "uses-permission-sdk-23: name='android.permission.ACCESS_MEDIA_LOCATION'",
    ]) {
      const badging = parseBadging(`${CLEAN_BADGING}${line}\n`);
      expect(() =>
        assertReleaseIdentity({ signers: [PROD_SIGNER], badging, tenant }),
      ).toThrow(/permissions not on the allow list/);
    }
  });

  it("allows the per-tenant dynamic receiver permission but not another tenant's", () => {
    const ours = parseBadging(
      `${CLEAN_BADGING}uses-permission: name='com.anyfun.foundation.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'\n`,
    );
    expect(() =>
      assertReleaseIdentity({ signers: [PROD_SIGNER], badging: ours, tenant }),
    ).not.toThrow();

    const theirs = parseBadging(
      `${CLEAN_BADGING}uses-permission: name='com.other.tenant.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'\n`,
    );
    expect(() =>
      assertReleaseIdentity({
        signers: [PROD_SIGNER],
        badging: theirs,
        tenant,
      }),
    ).toThrow(/permissions not on the allow list/);
  });

  // 商店包带着"应用内装 APK"既过不了审，也说明构建拿错了渠道配置
  it("allows REQUEST_INSTALL_PACKAGES only on the direct channel", () => {
    const badging = parseBadging(
      `${CLEAN_BADGING}uses-permission: name='android.permission.REQUEST_INSTALL_PACKAGES'\n`,
    );
    expect(() =>
      assertReleaseIdentity({ signers: [PROD_SIGNER], badging, tenant }),
    ).not.toThrow();
    expect(() =>
      assertReleaseIdentity({
        signers: [PROD_SIGNER],
        badging,
        tenant: { ...tenant, distributionChannel: "store" },
      }),
    ).toThrow(/REQUEST_INSTALL_PACKAGES/);
  });
});

// ---- 未签名包 ------------------------------------------------------------

function withTempDir(run) {
  const dir = mkdtempSync(join(tmpdir(), "rn-unsigned-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** apksigner 对未签名包的真实输出与退出码 */
const APKSIGNER_DOES_NOT_VERIFY =
  'echo "DOES NOT VERIFY"; echo "ERROR: Missing META-INF/MANIFEST.MF"; exit 1';

const directTenant = {
  androidPackage: "com.example.zzunsigned",
  androidVersionCode: 46,
  version: "1.3.16",
  distributionChannel: "direct",
};
const expectedConfig = {
  extra: {
    apiBaseUrl: "https://api.example.test",
    distributionChannel: "direct",
    appVersion: "1.3.16",
    buildNumber: "46",
  },
  runtimeVersion: "1.3.16",
};
const embedded = {
  extra: { ...expectedConfig.extra, walletConnectRedirectUrl: "x" },
  updates: { enabled: true },
  runtimeVersion: "1.3.16",
};
const unsignedApk = (overrides = {}) =>
  syntheticApk({
    packageName: directTenant.androidPackage,
    versionCode: directTenant.androidVersionCode,
    versionName: directTenant.version,
    permissions: [
      "android.permission.INTERNET",
      "android.permission.REQUEST_INSTALL_PACKAGES",
    ],
    appConfig: embedded,
    ...overrides,
  });

describe("no-signature assertion", () => {
  it("finds no signature evidence in an unsigned APK", () => {
    withTempDir((dir) => {
      const apk = join(dir, "app-release-unsigned.apk");
      writeFileSync(apk, unsignedApk());
      expect(signatureEvidence(apk)).toEqual([]);
    });
  });

  it("finds v1 signature files and an APK Signing Block without the Android SDK", () => {
    withTempDir((dir) => {
      const v1 = join(dir, "v1.apk");
      writeFileSync(
        v1,
        unsignedApk({
          extraEntries: [
            ["META-INF/MANIFEST.MF", "Manifest-Version: 1.0\n"],
            ["META-INF/CERT.SF", "x"],
            ["META-INF/CERT.RSA", "y"],
          ],
        }),
      );
      expect(signatureEvidence(v1)).toEqual([
        "v1 signature file META-INF/CERT.SF",
        "v1 signature file META-INF/CERT.RSA",
      ]);

      const v2 = join(dir, "v2.apk");
      writeFileSync(v2, unsignedApk({ signingBlock: true }));
      expect(signatureEvidence(v2)).toEqual([
        "APK Signing Block before the central directory",
      ]);
    });
  });

  it("does not mistake ordinary META-INF files for signatures", () => {
    withTempDir((dir) => {
      const apk = join(dir, "app.apk");
      writeFileSync(
        apk,
        unsignedApk({
          extraEntries: [
            ["META-INF/androidx.core_core.version", "1.0"],
            ["META-INF/services/x.RSA", "not at the top of META-INF"],
          ],
        }),
      );
      expect(signatureEvidence(apk)).toEqual([]);
    });
  });

  it("passes an unsigned APK that apksigner refuses to verify", () => {
    withTempDir((dir) => {
      const apk = join(dir, "app-release-unsigned.apk");
      writeFileSync(apk, unsignedApk());
      const sdkRoot = fakeSdk(dir, {
        scripts: { apksigner: APKSIGNER_DOES_NOT_VERIFY },
      });
      expect(() => assertApkUnsigned({ apkPath: apk, sdkRoot })).not.toThrow();
    });
  });

  it("rejects a signed APK before asking apksigner anything", () => {
    withTempDir((dir) => {
      const apk = join(dir, "app-release-unsigned.apk");
      writeFileSync(apk, unsignedApk({ signingBlock: true }));
      const marker = join(dir, "apksigner-ran");
      const sdkRoot = fakeSdk(dir, {
        scripts: { apksigner: `touch '${marker}'; exit 1` },
      });
      expect(() => assertApkUnsigned({ apkPath: apk, sdkRoot })).toThrow(
        /already signed \(APK Signing Block[\s\S]*only the signing gate signs/,
      );
      expect(existsSync(marker)).toBe(false);
    });
  });

  it("rejects an APK that apksigner verify accepts, even without structural evidence", () => {
    withTempDir((dir) => {
      const apk = join(dir, "app.apk");
      writeFileSync(apk, unsignedApk());
      const sdkRoot = fakeSdk(dir, { scripts: { apksigner: "exit 0" } });
      expect(() => assertApkUnsigned({ apkPath: apk, sdkRoot })).toThrow(
        /apksigner verify accepts this APK/,
      );
    });
  });

  // 工具本身跑不起来也是非 0 退出；那不是“没有签名”的证据
  it("does not treat a broken apksigner as proof the APK is unsigned", () => {
    withTempDir((dir) => {
      const apk = join(dir, "app.apk");
      writeFileSync(apk, unsignedApk());
      const sdkRoot = fakeSdk(dir, {
        scripts: { apksigner: 'echo "java: not found" >&2; exit 127' },
      });
      expect(() => assertApkUnsigned({ apkPath: apk, sdkRoot })).toThrow(
        /could not examine[\s\S]*not evidence the APK is unsigned/,
      );
    });
  });
});

describe("unsigned release early checks", () => {
  it("reads the embedded app.config out of the APK (deflated, like the real one)", () => {
    withTempDir((dir) => {
      const apk = join(dir, "app.apk");
      writeFileSync(apk, unsignedApk());
      expect(readEmbeddedAppConfig(apk)).toEqual(embedded);
    });
  });

  it("reports every embedded config mismatch", () => {
    expect(
      embeddedConfigProblems({
        appConfig: {
          extra: { ...embedded.extra, apiBaseUrl: "http://localhost:3000" },
          updates: { enabled: false },
          runtimeVersion: "1.3.15",
        },
        expected: expectedConfig,
      }),
    ).toEqual([
      "embedded app.config apiBaseUrl: expected https://api.example.test, received http://localhost:3000",
      "embedded app.config must enable production OTA updates",
      "embedded app.config runtimeVersion 1.3.15 does not match Expo config 1.3.16",
    ]);
  });

  it("passes an unsigned APK whose identity and embedded config match", () => {
    withTempDir((dir) => {
      const apk = join(dir, "app-release-unsigned.apk");
      writeFileSync(apk, unsignedApk());
      const sdkRoot = fakeSdk(dir, {
        scripts: {
          apksigner: APKSIGNER_DOES_NOT_VERIFY,
          aapt: `${fakeAaptScript({
            packageName: directTenant.androidPackage,
            versionCode: 46,
            versionName: "1.3.16",
          })}; echo "uses-permission: name='android.permission.INTERNET'"`,
        },
      });
      expect(
        verifyUnsignedReleaseApk({
          apkPath: apk,
          tenant: directTenant,
          sdkRoot,
          expectedConfig,
        }),
      ).toMatchObject({ packageName: directTenant.androidPackage });
    });
  });

  it("reports a signature, identity and embedded config problems in one go", () => {
    withTempDir((dir) => {
      const apk = join(dir, "app-release-unsigned.apk");
      writeFileSync(
        apk,
        unsignedApk({
          signingBlock: true,
          appConfig: { ...embedded, runtimeVersion: "0.0.1" },
        }),
      );
      const sdkRoot = fakeSdk(dir, {
        scripts: {
          apksigner: APKSIGNER_DOES_NOT_VERIFY,
          aapt: fakeAaptScript({
            packageName: "com.other.app",
            versionCode: 46,
            versionName: "1.3.16",
          }),
        },
      });
      expect(() =>
        verifyUnsignedReleaseApk({
          apkPath: apk,
          tenant: directTenant,
          sdkRoot,
          expectedConfig,
        }),
      ).toThrow(
        /Unsigned release check failed:[\s\S]*already signed[\s\S]*package com.other.app[\s\S]*runtimeVersion 0.0.1/,
      );
    });
  });
});

const tools = realBuildTools();
const describeWithRealTools = tools && hasJava() ? describe : describe.skip;

// 真实的 apksigner / aapt：合成包能被它们读懂，签过名的包两道检查都拦得住
describeWithRealTools("no-signature assertion against real build-tools", () => {
  it("accepts the synthetic unsigned APK and rejects the same APK once signed", () => {
    withTempDir((dir) => {
      const unsigned = join(dir, "app-release-unsigned.apk");
      writeFileSync(unsigned, unsignedApk());
      const sdkRoot = fakeSdk(dir, { link: tools });
      expect(() =>
        verifyUnsignedReleaseApk({
          apkPath: unsigned,
          tenant: directTenant,
          sdkRoot,
          expectedConfig,
        }),
      ).not.toThrow();

      const signed = join(dir, "signed.apk");
      signWithFreshKey({
        tools,
        workDir: join(dir, "key"),
        input: unsigned,
        output: signed,
      });
      expect(signatureEvidence(signed)).toContain(
        "APK Signing Block before the central directory",
      );
      expect(() => assertApkUnsigned({ apkPath: signed, sdkRoot })).toThrow(
        /already signed/,
      );
    });
  }, 60000);
});
