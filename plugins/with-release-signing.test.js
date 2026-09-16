/* global describe, it, expect */

const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const {
  UNSIGNED_RELEASE_MARKER,
  assertReleaseUnsigned,
  stripReleaseSigning,
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

/** buildTypes { release { … } } 的文本 */
function releaseBuildType(contents) {
  const buildTypes = contents.indexOf("buildTypes {");
  const start = contents.indexOf("release {", buildTypes);
  return contents.slice(start, contents.indexOf("}", start) + 1);
}

describe("release signing plugin: release APKs are unsigned", () => {
  it("leaves the release buildType without any signingConfig, so Gradle produces app-release-unsigned.apk", () => {
    const result = stripReleaseSigning(TEMPLATE);
    const release = releaseBuildType(result);

    expect(release).not.toMatch(/signingConfig/);
    expect(release).toContain(UNSIGNED_RELEASE_MARKER);
    // 其余 release 设置原样保留
    expect(release).toContain("shrinkResources false");
    expect(release).toContain("minifyEnabled enableMinifyInReleaseBuilds");
    // 模板里误导性的注释被移除
    expect(result).not.toContain("Caution! In production");
    expect(() => assertReleaseUnsigned(result)).not.toThrow();
  });

  it("keeps the debug buildType on the template debug keystore (expo run:android needs it)", () => {
    const result = stripReleaseSigning(TEMPLATE);
    const debugType = result.slice(
      result.indexOf("buildTypes {"),
      result.indexOf("release {", result.indexOf("buildTypes {")),
    );
    expect(debugType).toContain("signingConfig signingConfigs.debug");
  });

  it("injects no release signingConfig and reads no signing environment", () => {
    const result = stripReleaseSigning(TEMPLATE);
    const signingConfigs = result.slice(
      result.indexOf("signingConfigs {"),
      result.indexOf("buildTypes {"),
    );
    expect(signingConfigs).not.toMatch(/release\s*\{/);
    expect(result).not.toMatch(/getenv|ANDROID_RELEASE_/);
    const source = readFileSync(
      resolve(process.cwd(), "plugins/with-release-signing.js"),
      "utf8",
    );
    expect(source).not.toMatch(/process\.env|getenv|ANDROID_RELEASE_/);
  });

  it("strips any form of signingConfig from the release buildType", () => {
    for (const line of [
      "signingConfig signingConfigs.release",
      "signingConfig = signingConfigs.debug",
      "signingConfig signingConfigs.upload",
      "signingConfig signingConfigs.getByName('debug')",
    ]) {
      const input = TEMPLATE.replace(
        "signingConfig signingConfigs.debug\n            shrink",
        `${line}\n            shrink`,
      );
      expect(releaseBuildType(input)).toContain(line);
      const result = stripReleaseSigning(input);
      expect(releaseBuildType(result)).not.toMatch(/signingConfig/);
    }
  });

  // 单行写法：删掉签名语句之后右花括号不能被吞进标记注释那一行
  it("handles a single-line release block without swallowing the closing brace", () => {
    const singleLine = (body) =>
      TEMPLATE.replace(
        /        release \{[\s\S]*?\n        \}\n/,
        `        release { ${body} }\n`,
      );
    const input = singleLine("signingConfig signingConfigs.debug");
    expect(input).toContain("release { signingConfig signingConfigs.debug }");
    const result = stripReleaseSigning(input);
    expect(releaseBuildType(result)).toBe(
      `release {\n            ${UNSIGNED_RELEASE_MARKER}\n        }`,
    );
    expect(result).toMatch(/\n        \}\n    \}\n\}\n$/);
    expect(stripReleaseSigning(result)).toBe(result);

    // 同一行上的其他语句保留
    const mixed = stripReleaseSigning(
      singleLine(
        "signingConfig signingConfigs.debug; minifyEnabled enableMinifyInReleaseBuilds",
      ),
    );
    expect(releaseBuildType(mixed)).toBe(
      `release {\n            ${UNSIGNED_RELEASE_MARKER}\n            minifyEnabled enableMinifyInReleaseBuilds\n        }`,
    );
  });

  it("keeps the Expo 57 release block intact apart from the signing line", () => {
    const expo57 = TEMPLATE.replace(
      "            shrinkResources false\n            minifyEnabled enableMinifyInReleaseBuilds\n",
      [
        "            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'",
        "            shrinkResources enableShrinkResources.toBoolean()",
        "            minifyEnabled enableMinifyInReleaseBuilds",
        '            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"',
        "",
      ].join("\n"),
    );
    expect(releaseBuildType(stripReleaseSigning(expo57))).toBe(
      [
        "release {",
        `            ${UNSIGNED_RELEASE_MARKER}`,
        "            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'",
        "            shrinkResources enableShrinkResources.toBoolean()",
        "            minifyEnabled enableMinifyInReleaseBuilds",
        '            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"',
        "        }",
      ].join("\n"),
    );
  });

  it("is idempotent", () => {
    const once = stripReleaseSigning(TEMPLATE);
    expect(stripReleaseSigning(once)).toBe(once);
  });

  it("rejects a release buildType that still declares a signingConfig", () => {
    expect(() => assertReleaseUnsigned(TEMPLATE)).toThrow(
      /release buildType still declares a signingConfig/,
    );
  });

  it("refuses a build.gradle without a buildTypes.release block", () => {
    expect(() =>
      stripReleaseSigning("android {\n    buildTypes {\n    }\n}\n"),
    ).toThrow(/no release \{ block|buildTypes.release block not found/);
  });
});
