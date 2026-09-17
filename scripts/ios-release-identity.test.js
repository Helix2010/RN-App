const { expect, test } = require("@jest/globals");

const {
  appLinkHostOf,
  exportOptionsPlist,
  iosArtifactProblems,
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

test("appLinkHostOf 与 app.config.ts 同源，http 没有通用链接", () => {
  expect(appLinkHostOf("https://api.anyfun.win")).toBe("api.anyfun.win");
  expect(appLinkHostOf("https://api.anyfun.win/v1/")).toBe("api.anyfun.win");
  expect(appLinkHostOf("http://localhost:3000")).toBe("");
  expect(appLinkHostOf(undefined)).toBe("");
});
