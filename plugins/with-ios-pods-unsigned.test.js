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

const hookCount = (podfile) =>
  (podfile.match(/^\s*post_install do /gm) || []).length;

test("关签名那几行插进模板已有的 post_install 里，不另开一个", () => {
  const ios = newProject(TEMPLATE_PODFILE);
  runMod(ios);
  const podfile = readFileSync(resolve(ios, "Podfile"), "utf8");
  // CocoaPods 只允许一个：多一个就是 `[!] Specifying multiple post_install hooks
  // is unsupported.`，pod install 直接失败（2026-09-20 真机上第一次跑到就撞上了）
  expect(hookCount(podfile)).toBe(1);
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

// 模板哪天不再自带钩子时，这一段仍然要落地——那时才该自己开一个
test("Podfile 里没有 post_install 时自己开一个", () => {
  const ios = newProject("platform :ios, '15.1'\n\ntarget 'AnyFun' do\nend\n");
  runMod(ios);
  const podfile = readFileSync(resolve(ios, "Podfile"), "utf8");
  expect(hookCount(podfile)).toBe(1);
  expect(podfile).toContain("CODE_SIGNING_ALLOWED");
});

// 块参数不叫 installer 时，插进去的那几行也要用它的名字，否则 Ruby 里是个未定义变量
test("跟着已有块参数的名字走", () => {
  const ios = newProject(
    "target 'AnyFun' do\n  post_install do |inst|\n    react_native_post_install(inst, config[:reactNativePath])\n  end\nend\n",
  );
  runMod(ios);
  const podfile = readFileSync(resolve(ios, "Podfile"), "utf8");
  expect(hookCount(podfile)).toBe(1);
  expect(podfile).toContain("inst.pods_project.targets.each");
  expect(podfile).not.toContain("installer.pods_project.targets.each");
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
