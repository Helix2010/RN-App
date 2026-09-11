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
 * ## 为什么要一个开关，而不是永远开着
 *
 * Gradle 的依赖校验是靠"文件在不在"生效的，没有 lenient 档。一旦开着，**清单里
 * 少任何一条都会让构建失败**——升一个 Expo 小版本、加一个原生模块、甚至 AGP 换个
 * 变体，都会引入清单里没有的坐标。而这条路径是发布门禁：让它在无人预期的时候变红，
 * 结果一定是有人为了发版把校验关掉，然后再也不打开。
 *
 * 所以默认不安装：`GRADLE_DEPENDENCY_VERIFICATION=1` 才把文件放进 `android/`。
 * 先在 CI 上用这个开关跑一段时间，确认"改依赖 → 重新生成"这条流程真的走得通，
 * 再把默认改成开。
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

/** 开关：只有明确打开才安装。值的写法与仓库里其它开关一致。 */
function verificationRequested(env = process.env) {
  return /^(1|true|yes|on)$/i.test(env.GRADLE_DEPENDENCY_VERIFICATION ?? "");
}

/**
 * 决定这次 prebuild 要做什么。抽成纯函数是为了能直接测：
 * - `install`：把清单复制进去
 * - `remove`：开关没开，确保工程里不残留上一次装进去的清单
 *   （残留会让 Gradle 在没人打算开校验的时候突然开始校验）
 */
function verificationAction({ requested, sourceExists }) {
  if (!requested) return { kind: "remove" };
  if (!sourceExists)
    return {
      kind: "fail",
      message:
        `GRADLE_DEPENDENCY_VERIFICATION is on but ${SOURCE_RELATIVE_PATH} is missing. ` +
        `Generate it with \`pnpm android:verification-metadata <tenant>\`, or turn the switch off.`,
    };
  return { kind: "install" };
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

function withGradleDependencyVerification(config) {
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
          requested: verificationRequested(),
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
module.exports.verificationAction = verificationAction;
module.exports.verificationRequested = verificationRequested;
