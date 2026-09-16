const { withAppBuildGradle } = require("expo/config-plugins");

/**
 * Release 包一律不签名（RN-Server `docs/design/android-signing-gate-2026-09-16.md`「RN-App」）。
 *
 * 正式签名只在签名闸上做：构建机执行几千个第三方依赖的代码，按不可信处理，碰不到任何
 * 签名密钥；签名闸不执行仓库里的代码，只给它确认过的未签名包签名。所以这个插件**不注入**
 * 任何 signingConfig，也不读任何签名相关的环境变量。
 *
 * Expo 模板把 release buildType 绑在公开的 debug.keystore 上；`expo prebuild --clean`
 * 每次都会重生成 android/ 工程，只能在 prebuild 时把那一行删掉。删掉之后 AGP 产出
 * `app-release-unsigned.apk`。debug buildType 保持模板的 debug 签名（`expo run:android` 要用）。
 */

const MARKER =
  "// Unsigned by design: only the signing gate signs release APKs (plugins/with-release-signing.js)";
const TEMPLATE_CAUTION = [
  "// Caution! In production, you need to generate your own keystore file.",
  "// see https://reactnative.dev/docs/signed-apk-android.",
];
/**
 * release buildType 里任何形式的签名配置：`signingConfig signingConfigs.x`、`signingConfig = …`、
 * `signingConfigs.getByName('x')`。只删这一条语句，到行尾、`;` 或 `}` 为止，
 * 同一行上的其他语句（单行写法 `release { signingConfig …; minifyEnabled true }`）保留。
 */
const SIGNING_CONFIG_STATEMENT = /\bsigningConfig\b[^\n;}]*;?/g;

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

/** buildTypes { release { … } } 的范围；找不到就报错，模板变了要有人看一眼。 */
function releaseBuildTypeRange(contents) {
  const buildTypes = blockRange(contents, "buildTypes {");
  const release = blockRange(contents, "release {", buildTypes.open);
  if (release.close > buildTypes.close)
    throw new Error("buildTypes.release block not found in app/build.gradle");
  return release;
}

function stripReleaseSigning(contents) {
  const release = releaseBuildTypeRange(contents);
  // 按 `release {` 所在行的缩进重排整个块：单行写法删掉签名语句之后，右花括号也要落在自己那一行
  const lineStart = contents.lastIndexOf("\n", release.start) + 1;
  const outerIndent = /^\s*/.exec(contents.slice(lineStart, release.start))[0];
  const innerIndent = `${outerIndent}    `;
  const lines = contents
    .slice(release.open + 1, release.close)
    .replace(SIGNING_CONFIG_STATEMENT, "")
    .split("\n");
  const kept = lines
    // 和花括号同一行的内容没有自己的缩进，补上；中间的行保持原样
    .map((line, index) =>
      index === 0 || index === lines.length - 1
        ? `${innerIndent}${line.trim()}`
        : line,
    )
    .filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed !== "" &&
        !TEMPLATE_CAUTION.includes(trimmed) &&
        trimmed !== MARKER
      );
    });
  const block = [
    "{",
    `${innerIndent}${MARKER}`,
    ...kept,
    `${outerIndent}}`,
  ].join("\n");
  const result =
    contents.slice(0, release.open) + block + contents.slice(release.close + 1);
  assertReleaseUnsigned(result);
  return result;
}

/** 处理后的 release buildType 不得再有任何 signingConfig。 */
function assertReleaseUnsigned(contents) {
  const release = releaseBuildTypeRange(contents);
  const block = contents.slice(release.open, release.close + 1);
  if (/\bsigningConfig\b/.test(block))
    throw new Error(
      "release buildType still declares a signingConfig; release APKs must be unsigned",
    );
}

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (result) => {
    if (result.modResults.language !== "groovy")
      throw new Error("Release signing removal requires a Groovy build.gradle");
    result.modResults.contents = stripReleaseSigning(
      result.modResults.contents,
    );
    return result;
  });
}

module.exports = withReleaseSigning;
module.exports.stripReleaseSigning = stripReleaseSigning;
module.exports.assertReleaseUnsigned = assertReleaseUnsigned;
module.exports.UNSIGNED_RELEASE_MARKER = MARKER;
