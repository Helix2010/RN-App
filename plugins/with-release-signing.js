const { withAppBuildGradle } = require("expo/config-plugins");

/**
 * Release 签名注入（安全评审 N1，`docs/design/cross-platform-wallet-key-security-adversarial-review-2026-09-09.md` §4.2）。
 *
 * Expo 模板把 release buildType 绑在公开的 debug.keystore 上；`expo prebuild --clean`
 * 每次都会重生成 android/ 工程，所以直接改 build.gradle 会被覆盖，只能在 prebuild 时注入。
 * 注入的 signingConfig 只引用环境变量：口令与 keystore 路径不写进任何文件。
 * 缺任何一个变量，prebuild 与 Gradle 都直接失败，不会退回 debug 签名。
 */

const MARKER = "// AnyFun release signing (plugins/with-release-signing.js)";
const RELEASE_SIGNING_ENV = [
  "ANDROID_RELEASE_KEYSTORE_PATH",
  "ANDROID_RELEASE_STORE_PASSWORD",
  "ANDROID_RELEASE_KEY_ALIAS",
  "ANDROID_RELEASE_KEY_PASSWORD",
];
const RELEASE_SIGNING_CONFIG = `        release {
            ${MARKER}
            // Values are read from the environment at Gradle time; no secret is written here.
            def releaseKeystore = System.getenv("ANDROID_RELEASE_KEYSTORE_PATH")
            if (releaseKeystore == null || releaseKeystore.trim().isEmpty()) {
                throw new GradleException("ANDROID_RELEASE_KEYSTORE_PATH is required: release builds never use the debug keystore")
            }
            storeFile file(releaseKeystore)
            storePassword System.getenv("ANDROID_RELEASE_STORE_PASSWORD")
            keyAlias System.getenv("ANDROID_RELEASE_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_RELEASE_KEY_PASSWORD")
        }
`;
const TEMPLATE_CAUTION = [
  "            // Caution! In production, you need to generate your own keystore file.",
  "            // see https://reactnative.dev/docs/signed-apk-android.",
];

function missingReleaseSigningEnv(env = process.env) {
  return RELEASE_SIGNING_ENV.filter(
    (key) => typeof env[key] !== "string" || env[key].trim() === "",
  );
}

/** 从 `{` 的下标找到配对的 `}`；Gradle 这几个块里没有带花括号的字符串。 */
function findMatchingBrace(text, openIndex) {
  if (text[openIndex] !== "{") throw new Error("expected an opening brace");
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    if (text[index] === "{") depth += 1;
    if (text[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("unbalanced braces in build.gradle");
}

function blockRange(text, header, from = 0) {
  const start = text.indexOf(header, from);
  if (start === -1)
    throw new Error(`app/build.gradle has no ${header.trim()} block`);
  const open = text.indexOf("{", start);
  const close = findMatchingBrace(text, open);
  return { start, open, close };
}

function injectReleaseSigning(contents) {
  if (contents.includes(MARKER)) return contents;

  // 1. signingConfigs { debug {...} } → 在块尾追加 release {...}
  const signing = blockRange(contents, "signingConfigs {");
  let result =
    contents.slice(0, signing.close).replace(/\s*$/, "\n") +
    RELEASE_SIGNING_CONFIG +
    "    " +
    contents.slice(signing.close);

  // 2. buildTypes { release { signingConfig signingConfigs.debug } } → signingConfigs.release
  const buildTypes = blockRange(result, "buildTypes {");
  const release = blockRange(result, "release {", buildTypes.open);
  if (release.close > buildTypes.close)
    throw new Error("buildTypes.release block not found in app/build.gradle");
  let releaseBlock = result.slice(release.open, release.close + 1);
  for (const line of TEMPLATE_CAUTION)
    releaseBlock = releaseBlock.replace(`${line}\n`, "");
  releaseBlock = releaseBlock.replace(
    /signingConfig\s+signingConfigs\.debug/g,
    "signingConfig signingConfigs.release",
  );
  if (!releaseBlock.includes("signingConfig signingConfigs.release"))
    throw new Error(
      "buildTypes.release has no signingConfig to replace; template changed",
    );
  result =
    result.slice(0, release.open) +
    releaseBlock +
    result.slice(release.close + 1);
  return result;
}

/** 注入后的 release buildType 不得再引用 debug 签名。 */
function assertReleaseNotDebugSigned(contents) {
  const buildTypes = blockRange(contents, "buildTypes {");
  const release = blockRange(contents, "release {", buildTypes.open);
  const block = contents.slice(release.open, release.close + 1);
  if (block.includes("signingConfigs.debug"))
    throw new Error("release buildType still references signingConfigs.debug");
}

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (result) => {
    if (result.modResults.language !== "groovy")
      throw new Error(
        "Release signing injection requires a Groovy build.gradle",
      );
    const missing = missingReleaseSigningEnv();
    if (missing.length > 0)
      throw new Error(
        `Release signing requires ${missing.join(", ")} in the environment; ` +
          "see docs/SAAS_TENANT_BUILD_RUNBOOK.md §3. Release builds never fall back to the debug keystore.",
      );
    result.modResults.contents = injectReleaseSigning(
      result.modResults.contents,
    );
    assertReleaseNotDebugSigned(result.modResults.contents);
    return result;
  });
}

module.exports = withReleaseSigning;
module.exports.injectReleaseSigning = injectReleaseSigning;
module.exports.assertReleaseNotDebugSigned = assertReleaseNotDebugSigned;
module.exports.missingReleaseSigningEnv = missingReleaseSigningEnv;
module.exports.RELEASE_SIGNING_ENV = RELEASE_SIGNING_ENV;
module.exports.RELEASE_SIGNING_MARKER = MARKER;
