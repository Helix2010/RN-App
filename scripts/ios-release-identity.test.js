const { expect, test } = require("@jest/globals");
const { Buffer } = require("node:buffer");

const {
  appLinkHostOf,
  embeddedPlist,
  exportOptionsPlist,
  iosArtifactProblems,
  prebuildArgs,
} = require("./lib/ios-release-identity.js");

const tenant = {
  slug: "anyfun",
  iosBundleId: "com.anyfun.foundation",
  version: "1.3.16",
  iosBuildNumber: "9",
  apiBaseUrl: "https://api.anyfun.win",
  distributionChannel: "direct",
};

const goodInfoPlist = {
  CFBundleIdentifier: "com.anyfun.foundation",
  CFBundleShortVersionString: "1.3.16",
  CFBundleVersion: "9",
  NSFaceIDUsageDescription:
    "Allow AnyFun to use Face ID to unlock your wallet.",
  NSCameraUsageDescription: "Allow AnyFun to use the camera.",
};
const goodEntitlements = {
  "com.apple.developer.associated-domains": ["applinks:api.anyfun.win"],
};
const goodExpoConfig = {
  ios: { bundleIdentifier: "com.anyfun.foundation" },
  extra: {
    buildNumber: "9",
    apiBaseUrl: "https://api.anyfun.win",
    distributionChannel: "direct",
  },
  updates: { enabled: true, requestHeaders: { "x-build-number": "9" } },
};

const check = (overrides = {}) =>
  iosArtifactProblems({
    infoPlist: goodInfoPlist,
    entitlements: goodEntitlements,
    expoConfig: goodExpoConfig,
    tenant,
    appLinkHost: "api.anyfun.win",
    ...overrides,
  });

test("一个各项都对的产物没有问题", () => {
  expect(check()).toEqual([]);
});

// 这是这个门禁存在的首要理由：EXPO_OS 漏设时 Info.plist 与运行时请求头都正确，
// 只有内嵌的 extra.buildNumber 变成 Android 的 versionCode，而症状是 iOS 永远
// 收不到热更新——设备上看不出任何异常。
test("EXPO_OS 漏设导致内嵌 build 号错位时必须被拦住", () => {
  const problems = check({
    expoConfig: {
      ...goodExpoConfig,
      extra: { ...goodExpoConfig.extra, buildNumber: "46" },
      updates: { enabled: true, requestHeaders: { "x-build-number": "46" } },
    },
  });
  expect(problems).toHaveLength(2);
  expect(problems[0]).toContain("extra.buildNumber");
  expect(problems[0]).toContain("EXPO_OS");
  expect(problems[1]).toContain("x-build-number");
});

test("身份、版本、build 号对不上租户配置时逐条报出来", () => {
  const problems = check({
    infoPlist: {
      ...goodInfoPlist,
      CFBundleIdentifier: "com.someone.else",
      CFBundleShortVersionString: "1.3.15",
    },
  });
  // 版本错位会同时带出 CFBundleVersion 之外的比对，这里只要求两条身份问题都在
  expect(problems.some((p) => p.startsWith("CFBundleIdentifier"))).toBe(true);
  expect(problems.some((p) => p.startsWith("CFBundleShortVersionString"))).toBe(
    true,
  );
});

test("缺权限文案要拦住：iOS 是直接终止进程，不是弹窗被拒", () => {
  const { NSFaceIDUsageDescription, ...withoutFaceID } = goodInfoPlist;
  expect(NSFaceIDUsageDescription).toBeTruthy();
  const problems = check({ infoPlist: withoutFaceID });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("NSFaceIDUsageDescription");
});

test("没有 applinks entitlement 时通用链接不生效，必须拦住", () => {
  const problems = check({ entitlements: {} });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("applinks:api.anyfun.win");
});

// 出口合规是租户的法务判断，错误声明的后果落在租户主体上（设计 §8.2）
test("工程里写死出口合规答复要被拦住", () => {
  const problems = check({
    infoPlist: { ...goodInfoPlist, ITSAppUsesNonExemptEncryption: false },
  });
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("ITSAppUsesNonExemptEncryption");
});

// 关掉更新的包没有 OTA 请求头，不该因此报错
test("updates 关闭时不检查 OTA 请求头", () => {
  expect(
    check({
      expoConfig: { ...goodExpoConfig, updates: { enabled: false } },
    }),
  ).toEqual([]);
});

test("exportOptionsPlist 只产出 app-store-connect，并要求合法团队号", () => {
  const plist = exportOptionsPlist({ teamId: "AB12CD34EF" });
  expect(plist).toContain("<string>app-store-connect</string>");
  expect(plist).toContain("<string>AB12CD34EF</string>");
  expect(plist).toContain("<string>automatic</string>");
  // ad-hoc / enterprise 都不是普通用户能扫码装的东西，不该出现在这里
  expect(plist).not.toContain("ad-hoc");
  expect(plist).not.toContain("enterprise");
  for (const bad of ["", "AB12", "ab12cd34ef", "AB12CD34E-", undefined]) {
    expect(() => exportOptionsPlist({ teamId: bad })).toThrow();
  }
});

// 打包机上是手工签名：证书与描述文件由人放在机器上，构建一把 App Store Connect Key 都不拿。
// `xcodebuild -exportArchive` **只有 manual 才认** provisioningProfiles 这个字典——传了
// profileName 却留着 automatic，导出会去找 Xcode 账户，在无人值守的机器上卡住。
test("exportOptionsPlist 给了描述文件名就切到 manual 并写进映射", () => {
  const plist = exportOptionsPlist({
    teamId: "AB12CD34EF",
    bundleId: "com.anyfun.foundation",
    profileName: "AnyFun App Store",
  });
  expect(plist).toContain("<string>manual</string>");
  expect(plist).not.toContain("<string>automatic</string>");
  expect(plist).toContain("<key>provisioningProfiles</key>");
  expect(plist).toContain("<key>com.anyfun.foundation</key>");
  expect(plist).toContain("<string>AnyFun App Store</string>");
  // bundle id 是这个字典的键，少了它这份 plist 写不出来——不能默默产出一份半截的
  expect(() =>
    exportOptionsPlist({
      teamId: "AB12CD34EF",
      profileName: "AnyFun App Store",
    }),
  ).toThrow();
});

test("appLinkHostOf 与 app.config.ts 同源，http 没有通用链接", () => {
  expect(appLinkHostOf("https://api.anyfun.win")).toBe("api.anyfun.win");
  expect(appLinkHostOf("https://api.anyfun.win/v1/")).toBe("api.anyfun.win");
  expect(appLinkHostOf("http://localhost:3000")).toBe("");
  expect(appLinkHostOf(undefined)).toBe("");
});

// 描述文件的 plist 从 CMS 块里切出来，不走 `security cms -D`——那条命令会往默认钥匙串里
// 导签名者证书，而构建跑在任务自己的 HOME 下，没有 login 钥匙串：
//   security: cert import failed: Write permissions error.
//   security: problem decoding
// （2026-09-20 真机，CocoaPods 装完之后的下一步）
test("从 .mobileprovision 的字节里切出 plist，字节不动", () => {
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<plist version="1.0"><dict><key>Name</key><string>AnyFun 生产环境</string></dict></plist>';
  // 真文件前后都是二进制：CMS 头与签名尾
  const blob = Buffer.concat([
    Buffer.from([0x30, 0x82, 0x0b, 0x2a, 0x06, 0x09, 0xff, 0xfe]),
    Buffer.from(xml, "utf8"),
    Buffer.from([0x00, 0x01, 0x80, 0x81]),
  ]);

  const cut = embeddedPlist(blob.toString("latin1"));
  // 以 latin1 写回去之后必须与原始 XML 逐字节相同（中文在这里最容易坏）
  expect(Buffer.from(cut, "latin1").toString("utf8")).toBe(xml);
});

test("plist 找不到时说清楚是哪份文件", () => {
  expect(() =>
    embeddedPlist("no plist here", "/var/x/a.mobileprovision"),
  ).toThrow(/a\.mobileprovision/);
  // 只有开头没有结尾，也不能返回半截
  expect(() => embeddedPlist('<?xml version="1.0"?><plist>')).toThrow();
});

// 只有第一次 prebuild 带 --clean。重试时再带，会把已经装好的 Pods 删掉，等于每次从零
// 开始——而每次从零就是再赌一次二十分钟里 github.com 一次都不抖（2026-09-20 真机上
// 三次构建死了两次，都是 pod install 中途 clone 超时）。
test("prebuild 只有第一次清空 ios/", () => {
  expect(prebuildArgs(1)).toEqual([
    "exec",
    "expo",
    "prebuild",
    "--platform",
    "ios",
    "--clean",
  ]);
  for (const attempt of [2, 3]) {
    expect(prebuildArgs(attempt)).not.toContain("--clean");
    // 其余参数不能跟着变，否则重试跑的就不是同一件事
    expect(prebuildArgs(attempt)).toEqual([
      "exec",
      "expo",
      "prebuild",
      "--platform",
      "ios",
    ]);
  }
});
