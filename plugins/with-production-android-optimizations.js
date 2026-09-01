const {
  withDangerousMod,
  withGradleProperties,
  withSettingsGradle,
} = require("expo/config-plugins");
const { appendFileSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const MARKER = "// AnyFun production autolinking exclusions";
const PROGUARD_MARKER = "# AnyFun R8 suppressions";
// WalletConnect 的依赖树里带进了引用 java.awt 的桌面端代码（com.sun.jna）。
// Android 上没有 java.awt，这些引用是死代码，R8 只是缺类告警 —— 但会让构建失败。
const PROGUARD_RULES = `
${PROGUARD_MARKER}
-dontwarn java.awt.**
-dontwarn com.sun.jna.**
`;
const AUTOLINKING_CALL = "expoAutolinking.useExpoModules()";
const AUTOLINKING_SNIPPET = `${MARKER}
expoAutolinking.exclude = [
  'expo-dev-client',
  'expo-dev-launcher',
  'expo-dev-menu',
  'expo-dev-menu-interface',
]
`;

function setGradleProperty(properties, key, value) {
  const existing = properties.find(
    (item) => item.type === "property" && item.key === key,
  );
  if (existing) {
    existing.value = value;
  } else {
    properties.push({ type: "property", key, value });
  }
}

function withProductionAndroidOptimizations(config) {
  config = withDangerousMod(config, [
    "android",
    (result) => {
      const rules = join(
        result.modRequest.platformProjectRoot,
        "app/proguard-rules.pro",
      );
      if (!readFileSync(rules, "utf8").includes(PROGUARD_MARKER)) {
        appendFileSync(rules, PROGUARD_RULES);
      }
      return result;
    },
  ]);
  config = withSettingsGradle(config, (result) => {
    if (result.modResults.language !== "groovy") {
      throw new Error(
        "AnyFun production optimizations require Groovy settings.gradle",
      );
    }
    if (!result.modResults.contents.includes(MARKER)) {
      if (!result.modResults.contents.includes(AUTOLINKING_CALL)) {
        throw new Error(
          "Expo autolinking call was not found in settings.gradle",
        );
      }
      result.modResults.contents = result.modResults.contents.replace(
        AUTOLINKING_CALL,
        `${AUTOLINKING_SNIPPET}${AUTOLINKING_CALL}`,
      );
    }
    return result;
  });

  return withGradleProperties(config, (result) => {
    setGradleProperty(
      result.modResults,
      "reactNativeArchitectures",
      "armeabi-v7a,arm64-v8a",
    );
    setGradleProperty(
      result.modResults,
      "android.enableMinifyInReleaseBuilds",
      "true",
    );
    setGradleProperty(
      result.modResults,
      "android.enableShrinkResourcesInReleaseBuilds",
      "true",
    );
    setGradleProperty(result.modResults, "expo.useLegacyPackaging", "true");
    // Release builds run KSP + R8 across every autolinked module; the Expo
    // template default (-Xmx2048m -XX:MaxMetaspaceSize=512m) dies with
    // "OutOfMemoryError: Metaspace" in the ksp task.
    setGradleProperty(
      result.modResults,
      "org.gradle.jvmargs",
      "-Xmx4096m -XX:MaxMetaspaceSize=1024m",
    );
    return result;
  });
}

module.exports = withProductionAndroidOptimizations;
module.exports.injectProductionAutolinking = (contents) => {
  if (contents.includes(MARKER)) return contents;
  if (!contents.includes(AUTOLINKING_CALL)) {
    throw new Error("Expo autolinking call was not found in settings.gradle");
  }
  return contents.replace(
    AUTOLINKING_CALL,
    `${AUTOLINKING_SNIPPET}${AUTOLINKING_CALL}`,
  );
};
