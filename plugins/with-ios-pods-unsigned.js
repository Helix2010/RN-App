const { withDangerousMod } = require("expo/config-plugins");
const { readFileSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

/**
 * Podfile 的 `post_install` 里对**所有** Pods target 关掉代码签名。
 *
 * ## 为什么必须有这一步
 *
 * 手工签名时 App target 的 Release 配置带着 `PROVISIONING_PROFILE_SPECIFIER`。
 * Xcode 14 起资源 bundle 不再默认关签名，于是 Pods 里那些资源 bundle（`ExpoLocalization`
 * 这类 Expo 模块各带一个）也会去找描述文件，报：
 *
 *   ExpoLocalization does not support provisioning profiles, but provisioning profile
 *   … has been manually specified
 *
 * （expo/expo#29526，SDK 51 起可复现。）
 *
 * ## 为什么是"插进已有的钩子"而不是"再加一个"
 *
 * CocoaPods 只允许**一个** `post_install`，加第二个直接报：
 *
 *   [!] Specifying multiple `post_install` hooks is unsupported.
 *
 * 而 expo 生成的 Podfile 自带一个（里面调 `react_native_post_install`）。原先这里是
 * 往文件末尾追加一整段 `post_install`，于是 `pod install` 一律失败——2026-09-20 在真机上
 * 第一次跑到 CocoaPods 就撞上了。本仓的用例没挡住：夹具里有 `post_install`，插件又加一个，
 * 而用例只检查"某些字符串在不在"，从来不数有几个。现在用例数了。
 *
 * `expo-template-bare-minimum@sdk-57` 的 Podfile 只调 `react_native_post_install`，
 * 而它里面的 `turn_off_resource_bundle_react_core` **只对 React-Core 一个 pod** 的资源
 * bundle 关签名（react-native/scripts/cocoapods/utils.rb），Expo 模块的不在内。
 * 所以这一条不是"保险起见"，是缺了就构建不出来（2026-09-18 核实）。
 *
 * ## 为什么不走命令行全局覆盖
 *
 * `xcodebuild PROVISIONING_PROFILE_SPECIFIER=…` 会作用到工程里**每一个** target，
 * 包括 Pods 的。手工签名只该落在 App target 上（见 scripts/build-ios-release.mjs 里
 * 的 setProvisioningProfileForPbxproj），这个插件负责另一半：让 Pods 根本不签名。
 *
 * 设计 RN-Server docs/design/ios-mac-builders-home-network-2026-09-18.md §4.3b。
 */

const MARKER = "# rn-app: pods are never signed";

/** 关签名的那几行；`installer` 用调用处那个块参数的名字，缩进跟着它走。 */
const body = (installerVar, indent) =>
  [
    `${indent}${MARKER}`,
    `${indent}${installerVar}.pods_project.targets.each do |target|`,
    `${indent}  target.build_configurations.each do |config|`,
    `${indent}    config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'`,
    `${indent}    config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'`,
    `${indent}    config.build_settings['EXPANDED_CODE_SIGN_IDENTITY'] = ''`,
    `${indent}  end`,
    `${indent}end`,
  ].join("\n");

/** 已有的 `post_install do |xxx|` 那一行。取第一个就够：多于一个的 Podfile 本来就不合法。 */
const HOOK = /^([ \t]*)post_install do \|([A-Za-z_][A-Za-z0-9_]*)\|[ \t]*$/m;

/**
 * 把关签名那几行放进 Podfile。有现成的 `post_install` 就插进它里面，没有才自己开一个。
 *
 * 导出出来是为了能单独测：真跑一次 prebuild 太贵，而这段纯粹是文本处理。
 */
function patchPodfile(contents) {
  if (contents.includes(MARKER)) return contents;
  const hook = contents.match(HOOK);
  if (hook) {
    const [line, indent, installerVar] = hook;
    return contents.replace(
      line,
      `${line}\n${body(installerVar, `${indent}  `)}`,
    );
  }
  return `${contents.trimEnd()}\n\npost_install do |installer|\n${body("installer", "  ")}\nend\n`;
}

module.exports = function withIOSPodsUnsigned(config) {
  return withDangerousMod(config, [
    "ios",
    (mod) => {
      const podfile = resolve(mod.modRequest.platformProjectRoot, "Podfile");
      const contents = readFileSync(podfile, "utf8");
      // prebuild --clean 每次重新生成 Podfile，但 prebuild 不带 --clean 时不会：
      // 加两遍会让 CocoaPods 报重复定义
      const patched = patchPodfile(contents);
      if (patched !== contents) writeFileSync(podfile, patched);
      return mod;
    },
  ]);
};

module.exports.patchPodfile = patchPodfile;
