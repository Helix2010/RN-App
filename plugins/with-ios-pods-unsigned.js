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

const BLOCK = `
${MARKER}
post_install do |installer|
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
      config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'
      config.build_settings['EXPANDED_CODE_SIGN_IDENTITY'] = ''
    end
  end
end
`;

module.exports = function withIOSPodsUnsigned(config) {
  return withDangerousMod(config, [
    "ios",
    (mod) => {
      const podfile = resolve(mod.modRequest.platformProjectRoot, "Podfile");
      const contents = readFileSync(podfile, "utf8");
      // prebuild --clean 每次重新生成 Podfile，但 prebuild 不带 --clean 时不会：
      // 加两遍 post_install 会让 CocoaPods 直接报重复定义
      if (contents.includes(MARKER)) return mod;
      writeFileSync(podfile, `${contents.trimEnd()}\n${BLOCK}`);
      return mod;
    },
  ]);
};
