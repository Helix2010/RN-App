/* global test, expect */

const {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");

const withIOSPodsUnsigned = require("./with-ios-pods-unsigned.js");

// withDangerousMod 把回调挂在 config 上；这里直接把它取出来跑，不起一次真的 prebuild
const runMod = (platformProjectRoot) => {
  let captured;
  const config = withIOSPodsUnsigned({
    name: "test",
    slug: "test",
    mods: {},
  });
  // expo/config-plugins 会把回调放进 config.mods.ios.dangerous
  captured = config.mods.ios.dangerous;
  return captured({ modRequest: { platformProjectRoot }, modResults: {} });
};

const newProject = (podfile) => {
  const root = mkdtempSync(resolve(tmpdir(), "rn-pods-"));
  mkdirSync(resolve(root, "ios"), { recursive: true });
  writeFileSync(resolve(root, "ios", "Podfile"), podfile);
  return resolve(root, "ios");
};

const TEMPLATE_PODFILE = `require Pod::Executable.execute_command('node', ['-p', 'require.resolve("react-native/scripts/react_native_pods.rb")'], true).strip

platform :ios, '15.1'

target 'AnyFun' do
  use_expo_modules!
  post_install do |installer|
    react_native_post_install(installer, config[:reactNativePath])
  end
end
`;

test("给 Podfile 追加一段关掉所有 Pods 签名的 post_install", () => {
  const ios = newProject(TEMPLATE_PODFILE);
  runMod(ios);
  const podfile = readFileSync(resolve(ios, "Podfile"), "utf8");
  // 模板原来的内容不能被动
  expect(podfile).toContain("react_native_post_install(installer");
  for (const setting of [
    "CODE_SIGNING_ALLOWED",
    "CODE_SIGNING_REQUIRED",
    "EXPANDED_CODE_SIGN_IDENTITY",
  ]) {
    expect(podfile).toContain(setting);
  }
  expect(podfile).toContain("installer.pods_project.targets.each");
});

// prebuild 不带 --clean 时不会重新生成 Podfile：加两遍 post_install 会让 CocoaPods
// 直接报重复定义，而那条报错完全不像"插件跑了两次"
test("重复跑不会追加第二遍", () => {
  const ios = newProject(TEMPLATE_PODFILE);
  runMod(ios);
  const once = readFileSync(resolve(ios, "Podfile"), "utf8");
  runMod(ios);
  expect(readFileSync(resolve(ios, "Podfile"), "utf8")).toBe(once);
});
