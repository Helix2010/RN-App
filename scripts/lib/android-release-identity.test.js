/* global describe, it, expect */

const {
  DEBUG_SIGNER_SHA256,
  assertReleaseIdentity,
  parseBadging,
  parseSignerDigests,
} = require("./android-release-identity");

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
    const badging = parseBadging(
      BADGING.replace(
        /^uses-permission: name='android.permission.SYSTEM_ALERT_WINDOW'\n/m,
        "",
      ),
    );
    expect(
      assertReleaseIdentity({ signers: [PROD_SIGNER], badging, tenant }),
    ).toMatchObject({
      signer: PROD_SIGNER,
      packageName: "com.anyfun.foundation",
    });
  });
});
