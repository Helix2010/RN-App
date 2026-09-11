const { withProjectBuildGradle } = require("expo/config-plugins");

/**
 * 去掉 Expo 模板默认加的 jitpack 仓库（安全评审 N28）。
 *
 * jitpack 按 GitHub 坐标现编现发，同一个坐标的内容可以随作者的仓库变化，而它就排在
 * google() 和 mavenCentral() 后面——任何一个这两处解析不到的坐标都会落到它身上。
 *
 * 2026-09-11 核对过：`gradle/verification-metadata.xml` 的 1313 个组件里没有一个来自
 * jitpack，也就是说这条仓库今天纯属多余。留着它的代价是一个随时可能被用上的、内容
 * 可变的来源；去掉它的代价是**将来真需要时构建会当场失败**，而那正是我们想要的
 * ——失败比静默地从一个不可信来源拉东西好。
 *
 * `android/` 是 prebuild 生成的、不入库，所以这件事只能作为插件做。
 */
const JITPACK =
  /^\s*maven\s*\{\s*url\s*['"]https:\/\/(www\.)?jitpack\.io['"]\s*\}\s*$/gm;

/** 从 build.gradle 文本里删掉 jitpack 那一行。导出给测试用。 */
function removeJitpack(contents) {
  return contents.replace(JITPACK, "").replace(/\n{3,}/g, "\n\n");
}

module.exports = function withPinnedMavenRepositories(config) {
  return withProjectBuildGradle(config, (result) => {
    if (result.modResults.language !== "groovy") {
      throw new Error(
        "Removing the jitpack repository requires a Groovy build.gradle",
      );
    }
    result.modResults.contents = removeJitpack(result.modResults.contents);
    return result;
  });
};

module.exports.removeJitpack = removeJitpack;
