const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { describe, expect, test } = require("@jest/globals");

const {
  packagePodspec,
  PINNED_PODS,
  PINNED_PODS_DIRECTORY,
  pinnedPodProblems,
  pinPodfile,
} = require("./ios-pinned-pods.js");
const { zipArchive } = require("./apk-test-fixture.js");

const [yttrium] = PINNED_PODS;
// jest 从仓库根跑（其它脚本测试也这么取）
const projectRoot = process.cwd();

// WalletConnect 一升级 YttriumWrapper，这里先红——比在 Mac 上跑到 pod install 才发现早二十分钟
test("钉住的版本就是依赖里要的版本", () => {
  expect(
    pinnedPodProblems(PINNED_PODS, (name) => packagePodspec(projectRoot, name)),
  ).toEqual([]);
});

describe("pinnedPodProblems", () => {
  const withDependency = (line) => () => `Pod::Spec.new do |s|\n${line}\nend\n`;

  test("版本对得上（写成 = 0.10.54 也算）", () => {
    for (const line of [
      `  s.dependency "YttriumWrapper", "${yttrium.version}"`,
      `  s.dependency 'YttriumWrapper', '= ${yttrium.version}'`,
    ])
      expect(pinnedPodProblems([yttrium], withDependency(line))).toEqual([]);
  });

  test("依赖换了版本：要人来更新钉子", () => {
    const [problem] = pinnedPodProblems(
      [yttrium],
      withDependency('  s.dependency "YttriumWrapper", "0.10.60"'),
    );
    expect(problem).toContain("0.10.60");
    expect(problem).toContain(yttrium.version);
  });

  test("不限版本也不行：那样 trunk 上会装最新的，钉子就没意义了", () => {
    expect(
      pinnedPodProblems(
        [yttrium],
        withDependency('  s.dependency "YttriumWrapper"'),
      ),
    ).toHaveLength(1);
  });

  test("依赖不要它了：钉子该删", () => {
    const [problem] = pinnedPodProblems(
      [yttrium],
      withDependency('  s.dependency "React-Core"'),
    );
    expect(problem).toContain("已经不依赖");
  });
});

describe("pinPodfile", () => {
  // prebuild 生成的 Podfile 的形状（expo SDK 57 模板，节选）
  const podfile = `prepare_react_native_project!

target 'AnyFun' do
  use_expo_modules!

  config = use_native_modules!(config_command)

  post_install do |installer|
    react_native_post_install(installer, config[:reactNativePath])
  end
end
`;

  test("加在 App target 的第一行，缩进跟着 target 走", () => {
    const pinned = pinPodfile(podfile, PINNED_PODS);
    expect(pinned).toContain(
      `target 'AnyFun' do\n  # rn-app: pinned pods (scripts/lib/ios-pinned-pods.js)\n` +
        `  pod 'YttriumWrapper', :podspec => '${PINNED_PODS_DIRECTORY}/YttriumWrapper.podspec'\n` +
        "  use_expo_modules!",
    );
    // 其余一个字不动
    expect(pinned.replace(/\n  # rn-app: pinned pods.*\n  pod .*/, "")).toBe(
      podfile,
    );
  });

  test("找不到 target 就失败，不猜往哪儿加", () => {
    expect(() => pinPodfile("platform :ios, '16.4'\n", PINNED_PODS)).toThrow(
      /target/,
    );
  });
});

describe("YttriumWrapper 的 podspec", () => {
  const podspec = yttrium.podspec(yttrium);
  const prepareCommand = /<<-SCRIPT\n([\s\S]*?)^SCRIPT$/m.exec(podspec)[1];

  test("从固定地址下、按 sha256 校验，不再从 github.com 的 release 下", () => {
    expect(podspec).toContain(`s.name         = 'YttriumWrapper'`);
    expect(podspec).toContain(`s.version      = '${yttrium.version}'`);
    expect(prepareCommand).toContain(`'${yttrium.url}'`);
    expect(prepareCommand).toContain(`${yttrium.sha256}  `);
    expect(prepareCommand).toContain("shasum -a 256 -c -");
    expect(prepareCommand).toContain("--fail");
    expect(podspec).not.toContain("releases/download");
    expect(yttrium.url).toMatch(/^https:\/\//);
    expect(yttrium.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  // prepare_command 放在 Ruby 的 <<-SCRIPT 里，那是双引号语义：反斜杠和 #{} 会被 Ruby 先处理掉，
  // 到 bash 手里就不是这里写的样子了。任务环境的 LANG 不归我们管，所以只用 ASCII
  test("能原样放进 Ruby heredoc", () => {
    expect(prepareCommand).not.toMatch(/\\|#[{$@]/);
    expect(podspec).toMatch(/^[\x20-\x7e\n]*$/);
  });

  const hasTools =
    spawnSync("bash", [
      "-c",
      "command -v curl && command -v shasum && command -v unzip",
    ]).status === 0;

  // 上游 release 里的 zip 的形状：头文件在 Headers/yttriumFFI/ 下，prepare_command 要把它们提上来
  const frameworkZip = zipArchive([
    ["target/ios/libyttrium.xcframework/Info.plist", "<plist/>"],
    ["target/ios/libyttrium.xcframework/ios-arm64/libyttrium.a", "arm64"],
    [
      "target/ios/libyttrium.xcframework/ios-arm64/Headers/yttriumFFI/yttriumFFI.h",
      "// device",
    ],
    [
      "target/ios/libyttrium.xcframework/ios-arm64_x86_64-simulator/Headers/yttriumFFI/yttriumFFI.h",
      "// simulator",
    ],
  ]);

  /** 按 CocoaPods 的方式跑 prepare_command：在 pod 的源码目录里 `bash -c "set -e\n<命令>"` */
  function runPrepare(pin) {
    const root = mkdtempSync(join(tmpdir(), "rn-pinned-pod-"));
    try {
      const archive = join(root, "libyttrium.xcframework.zip");
      writeFileSync(archive, frameworkZip);
      const source = join(root, "source");
      mkdirSync(join(source, "platforms/swift/Sources/Yttrium"), {
        recursive: true,
      });
      writeFileSync(
        join(source, "platforms/swift/Sources/Yttrium/Yttrium.swift"),
        "// swift",
      );
      const command = /<<-SCRIPT\n([\s\S]*?)^SCRIPT$/m.exec(
        pin.podspec({ ...pin, url: pathToFileURL(archive).href }),
      )[1];
      const result = spawnSync("bash", ["-c", `\nset -e\n${command}`], {
        cwd: source,
        encoding: "utf8",
      });
      const framework = join(
        source,
        "platforms/swift/target/ios/libyttrium.xcframework",
      );
      const list = (dir) =>
        existsSync(join(framework, dir))
          ? readdirSync(join(framework, dir)).sort()
          : null;
      return {
        status: result.status,
        stderr: result.stderr,
        zipLeft: existsSync(join(source, "libyttrium.xcframework.zip")),
        device: list("ios-arm64/Headers"),
        simulator: list("ios-arm64_x86_64-simulator/Headers"),
      };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  (hasTools ? test : test.skip)(
    "校验通过：解开、头文件提上来、Swift 源码拷进 Headers",
    () => {
      const sha256 = createHash("sha256").update(frameworkZip).digest("hex");
      const result = runPrepare({ ...yttrium, sha256 });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.zipLeft).toBe(false);
      expect(result.device).toEqual(["Yttrium.swift", "yttriumFFI.h"]);
      expect(result.simulator).toEqual(["Yttrium.swift", "yttriumFFI.h"]);
    },
  );

  (hasTools ? test : test.skip)("sha256 对不上：失败，什么都不解开", () => {
    const result = runPrepare({ ...yttrium, sha256: "0".repeat(64) });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("is not the pinned file");
    expect(result.device).toBeNull();
  });
});
