/* global describe, it, expect */

const {
  assertReleaseNotDebugSigned,
  injectReleaseSigning,
  missingReleaseSigningEnv,
} = require("./with-release-signing");

// 与 expo prebuild 生成的 android/app/build.gradle 相同的片段
const TEMPLATE = `android {
    defaultConfig {
        applicationId 'com.anyfun.foundation'
        versionCode 25
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            shrinkResources false
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

describe("release signing plugin", () => {
  it("adds an environment-backed release signingConfig and points buildTypes.release at it", () => {
    const result = injectReleaseSigning(TEMPLATE);

    expect(result).toContain("release {");
    expect(result).toContain('System.getenv("ANDROID_RELEASE_KEYSTORE_PATH")');
    expect(result).toContain("signingConfig signingConfigs.release");
    // debug buildType 仍用 debug 签名（本地 expo run:android 需要）
    const debugType = result.slice(
      result.indexOf("buildTypes {"),
      result.indexOf("release {", result.indexOf("buildTypes {")),
    );
    expect(debugType).toContain("signingConfig signingConfigs.debug");
    // 模板里误导性的注释被移除
    expect(result).not.toContain("Caution! In production");
    expect(() => assertReleaseNotDebugSigned(result)).not.toThrow();
  });

  it("never writes a password or keystore path into the file", () => {
    const result = injectReleaseSigning(TEMPLATE);
    const releaseSigning = result.slice(
      result.indexOf("AnyFun release signing"),
      result.indexOf("buildTypes {"),
    );
    expect(releaseSigning).not.toMatch(/storePassword\s+'/);
    expect(releaseSigning).not.toMatch(/keyPassword\s+'/);
    expect(releaseSigning).not.toMatch(/file\('/);
  });

  it("is idempotent", () => {
    const once = injectReleaseSigning(TEMPLATE);
    expect(injectReleaseSigning(once)).toBe(once);
  });

  it("rejects a release buildType that still uses the debug keystore", () => {
    expect(() => assertReleaseNotDebugSigned(TEMPLATE)).toThrow(
      /still references signingConfigs.debug/,
    );
  });

  it("refuses templates without a replaceable release signingConfig", () => {
    expect(() =>
      injectReleaseSigning(
        TEMPLATE.replace(
          "            signingConfig signingConfigs.debug\n            shrinkResources",
          "            shrinkResources",
        ),
      ),
    ).toThrow(/no signingConfig to replace/);
  });

  it("lists every missing signing variable", () => {
    expect(missingReleaseSigningEnv({})).toEqual([
      "ANDROID_RELEASE_KEYSTORE_PATH",
      "ANDROID_RELEASE_STORE_PASSWORD",
      "ANDROID_RELEASE_KEY_ALIAS",
      "ANDROID_RELEASE_KEY_PASSWORD",
    ]);
    expect(
      missingReleaseSigningEnv({
        ANDROID_RELEASE_KEYSTORE_PATH: "/tmp/k.jks",
        ANDROID_RELEASE_STORE_PASSWORD: "x",
        ANDROID_RELEASE_KEY_ALIAS: "  ",
        ANDROID_RELEASE_KEY_PASSWORD: "y",
      }),
    ).toEqual(["ANDROID_RELEASE_KEY_ALIAS"]);
  });
});
