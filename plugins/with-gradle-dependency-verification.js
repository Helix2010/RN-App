const { withDangerousMod } = require("expo/config-plugins");
const { copyFileSync, existsSync, mkdirSync, rmSync } = require("node:fs");
const { dirname, join } = require("node:path");

/**
 * Gradle 依赖校验（安全评审 N28）。
 *
 * `gradle/verification-metadata.xml` 给每一个解析到的 Android 依赖记一个 sha256。
 * 文件在位时 Gradle 会在**下载之后、使用之前**逐个比对，对不上就停——被顶替的
 * maven 仓库、被改写的缓存、下毒的传递依赖都会当场失败，而不是安静地进 APK。
 *
 * ## 什么时候装
 *
 * **所有非 development 渠道的构建都装，没有开关**（签名闸设计 android-signing-gate-2026-09-16）。
 * release 包由构建机产出，构建机执行几千个第三方依赖的代码；依赖校验是它交给签名闸
 * 之前唯一挡得住"被顶替的依赖"的地方，不能留一个能关掉它的环境变量。
 *
 * development 渠道（`expo run:android`、开发包名自测）不装，并删掉工程里残留的清单：
 * 开发构建会链接 expo-dev-client 一系，解析到的坐标和清单不是同一套，而开发包不分发。
 *
 * Gradle 的依赖校验靠"文件在不在"生效，没有 lenient 档：清单里少任何一条都会让构建
 * 失败。改依赖（升 Expo、加原生模块、AGP 换变体）就必须连带重新生成清单，这是预期
 * 行为，不要靠删清单绕过去。
 *
 * ## 重新生成
 *
 * 清单跟着依赖走，不是一次性文件：
 *
 * ```
 * pnpm android:verification-metadata anyfun
 * ```
 *
 * 它跑一次真实的 release 构建并让 Gradle 记下全部解析结果——只有真实构建才覆盖得到
 * 所有配置（buildscript 类路径、各个 Expo 子工程、变体相关的依赖）。
 */

/** 仓库里那份清单的位置（`android/` 是 prebuild 生成的，不入库）。 */
const SOURCE_RELATIVE_PATH = "gradle/verification-metadata.xml";

/** 装进 Android 工程里的位置——Gradle 只认这一个路径。 */
const TARGET_RELATIVE_PATH = "gradle/verification-metadata.xml";

const DISTRIBUTION_CHANNELS = [
  "development",
  "staging",
  "store",
  "direct",
  "mdm",
];

/**
 * 决定这次 prebuild 要做什么。抽成纯函数是为了能直接测：
 * - `install`：非 development 渠道，把清单复制进去
 * - `remove`：development 渠道，确保工程里不残留上一次装进去的清单
 *   （残留会让开发构建拿一份不对应的清单去校验）
 * - `fail`：渠道不认识，或者该装的时候仓库里没有清单
 */
function verificationAction({ distributionChannel, sourceExists }) {
  if (!DISTRIBUTION_CHANNELS.includes(distributionChannel))
    return {
      kind: "fail",
      message: `Gradle dependency verification needs the distribution channel; received ${distributionChannel}`,
    };
  if (distributionChannel === "development") return { kind: "remove" };
  if (!sourceExists)
    return {
      kind: "fail",
      message:
        `${distributionChannel} builds enforce Gradle dependency verification but ${SOURCE_RELATIVE_PATH} is missing. ` +
        `Generate it with \`pnpm android:verification-metadata <tenant>\`.`,
    };
  return { kind: "install" };
}

/**
 * release 构建前检查"校验真的会发生"。
 *
 * Gradle 的依赖校验**成功时完全静默**——日志里既不说校验已开启，也不说校验了多少个。
 * 于是「清单没装进去」和「装进去且全部通过」在 CI 上长得一模一样：都是绿的。一个
 * 不声不响没跑的安全检查比没有这项检查更坏，因为它让人以为已经查过了。
 *
 * 返回 `null` 表示确实在强制执行；返回字符串是要抛出去的原因。
 */
function enforcementProblem({ installed, components, floor }) {
  if (!installed)
    return (
      `Gradle dependency verification is mandatory for release builds but prebuild left no ${TARGET_RELATIVE_PATH} ` +
      `in android/; Gradle would resolve every dependency without checking a single one`
    );
  if (components < floor)
    return (
      `${TARGET_RELATIVE_PATH} pins only ${components} components (floor ${floor}); ` +
      `a truncated manifest enforces almost nothing`
    );
  return null;
}

function applyVerificationAction(action, { source, target }) {
  if (action.kind === "fail") throw new Error(action.message);
  if (action.kind === "remove") {
    rmSync(target, { force: true });
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}

function withGradleDependencyVerification(
  config,
  { distributionChannel } = {},
) {
  return withDangerousMod(config, [
    "android",
    (result) => {
      const source = join(result.modRequest.projectRoot, SOURCE_RELATIVE_PATH);
      const target = join(
        result.modRequest.platformProjectRoot,
        TARGET_RELATIVE_PATH,
      );
      applyVerificationAction(
        verificationAction({
          distributionChannel,
          sourceExists: existsSync(source),
        }),
        { source, target },
      );
      return result;
    },
  ]);
}

module.exports = withGradleDependencyVerification;
module.exports.SOURCE_RELATIVE_PATH = SOURCE_RELATIVE_PATH;
module.exports.TARGET_RELATIVE_PATH = TARGET_RELATIVE_PATH;
module.exports.applyVerificationAction = applyVerificationAction;
module.exports.enforcementProblem = enforcementProblem;
module.exports.verificationAction = verificationAction;
