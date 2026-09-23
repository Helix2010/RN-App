const { expect, test } = require("@jest/globals");
const { Buffer } = require("node:buffer");

const {
  appLinkHostOf,
  embeddedPlist,
  exportOptionsPlist,
  iosArtifactProblems,
  plistDate,
  prebuildArgs,
  provisioningProfilePaths,
  xcodebuildDigest,
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
// 名字别写成「只有第一次清空 ios/」：那不是这段代码能保证的事。expo 在 ios/ 残缺时
// 自己就会清（非交互模式下默认清 malformed 工程），重试时不带 --clean 拦不住它。
// 这里断言的只是「--clean 只出现在第一次」——省掉的是上个任务的残留，不是 pod 缓存。
test("prebuild 只有第一次带 --clean", () => {
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

// 真机 2026-09-20：整份描述文件转 JSON 会被 plutil 拒（`Invalid object in plist for
// JSON format`），因为里面有 <data> 与 <date>。改成按 keypath 取，日期这一格走 xml1。
test("从 plutil -extract xml1 的输出里切出日期", () => {
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<date>2027-09-20T03:03:38Z</date>",
    "</plist>",
    "",
  ].join("\n");
  expect(plistDate(xml)).toBe("2027-09-20T03:03:38Z");
  // 切出来的东西必须真的是个日期——否则过期检查会退化成 NaN 比较，恒为"没过期"
  expect(Number.isFinite(new Date(plistDate(xml)).getTime())).toBe(true);
});

test("读不出日期时回 null，不回 undefined 也不抛", () => {
  // plutil 取不到键时 readProfileFields 传进来的就是 null
  for (const input of [
    null,
    undefined,
    "",
    '<plist version="1.0"><string>x</string></plist>',
  ])
    expect(plistDate(input)).toBeNull();
});

// 2026-09-21 真机：第一次编译起来就倒在这里——描述文件读到了、名字也对，但 Xcode 按
// 名字找的是它自己的已安装目录，我们的文件躺在 /var/rn-build-signing 下它看不见：
//   error: No profile for team 'J4JDFC8LCC' matching '…' found: Xcode couldn't find
//   any provisioning profiles matching … Install the profile …
test("描述文件装进 Xcode 的两个候选目录，文件名用 UUID", () => {
  const uuid = "7B69482C-C050-4980-B41B-47670BE74050";
  const paths = provisioningProfilePaths("/var/jobs/x/work/home", uuid);

  // 两个目录都要：Xcode 16 起用 UserData 那个，更早的用 MobileDevice 那个
  expect(paths).toEqual([
    `/var/jobs/x/work/home/Library/Developer/Xcode/UserData/Provisioning Profiles/${uuid}.mobileprovision`,
    `/var/jobs/x/work/home/Library/MobileDevice/Provisioning Profiles/${uuid}.mobileprovision`,
  ]);

  // 没有 HOME 就定不了位置，不能默默装到某个默认路径去
  expect(() => provisioningProfilePaths("", uuid)).toThrow();
  expect(() => provisioningProfilePaths(undefined, uuid)).toThrow();

  // UUID 形状不对时当场报错：拼进路径的东西不能是 undefined 或带斜杠的串
  for (const bad of [undefined, null, "", "not-a-uuid", "../../etc/passwd"])
    expect(() => provisioningProfilePaths("/home/x", bad)).toThrow();
});

// 控制台只留最后 200 行，一次 archive 上万行——2026-09-21 连着两轮，脚本自己的诊断行
// 被挤出窗口。摘要要保证：真正的 error 行一定在，而且总长度远小于 200。
test("xcodebuild 摘要保留 error 行与横幅，去重，且篇幅有上限", () => {
  const noise = Array.from({ length: 5000 }, (_, i) => `CompileC file${i}.m`);
  const err =
    "/x/AnyFun.xcodeproj: error: No profile for team 'J4JDFC8LCC' matching 'P' found";
  const output = [
    ...noise.slice(0, 2500),
    err,
    ...noise.slice(2500),
    err, // 同一条错误 xcodebuild 常常打两遍
    "** ARCHIVE FAILED **",
    "",
  ].join("\n");

  const digest = xcodebuildDigest(output);
  const lines = digest.split("\n");
  // 埋在第 2500 行的那条错误必须被捞出来，而且只出现在 error 段一次（尾段里另算）
  const errorSection = lines.slice(
    0,
    lines.indexOf(lines.find((l) => l.startsWith("—— 最后"))),
  );
  expect(errorSection.filter((l) => l === err)).toHaveLength(1);
  expect(errorSection).toContain("** ARCHIVE FAILED **");
  // 尾段是真正的最后几行，末尾的空行不算
  expect(lines.at(-1)).toBe("** ARCHIVE FAILED **");
  // 篇幅：40 条 error + 30 行尾 + 2 行标题，留足窗口给别的诊断
  expect(lines.length).toBeLessThanOrEqual(72);
});

test("xcodebuild 摘要在没有 error 行时说清楚，而不是给一段空白", () => {
  const digest = xcodebuildDigest("line 1\nline 2\n");
  expect(digest).toContain("（没有 error: 行）");
  expect(digest).toContain("line 2");
  for (const empty of ["", null, undefined])
    expect(() => xcodebuildDigest(empty)).not.toThrow();
});

test("xcodebuild 摘要的 error 段有上限：几百条级联错误不能把窗口占满", () => {
  const many = Array.from(
    { length: 500 },
    (_, i) => `f${i}.swift:1: error: e${i}`,
  ).join("\n");
  const lines = xcodebuildDigest(many).split("\n");
  expect(
    lines.filter((l) => /: error: e\d+$/.test(l)).length,
  ).toBeLessThanOrEqual(40 + 30);
  expect(lines.length).toBeLessThanOrEqual(72);
});
