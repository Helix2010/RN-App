/**
 * iOS 正式包的产物门禁（设计 RN-Server docs/design/ios-testflight-distribution-2026-09-17.md §4.4）。
 *
 * 与 Android 那侧（lib/android-release-identity.js）同一个用意：把"这个包到底是什么"
 * 从产物里读出来，和租户配置逐条比。iOS 这边尤其必要，因为签名与打包在
 * `xcodebuild -exportArchive` 里一步完成，产物直接上传 App Store Connect——包一旦
 * 传上去、被 TestFlight 分发出去，改不回来，只能出新 build。
 *
 * 这个文件只做纯函数：调用方负责把 Info.plist、entitlements 与 Expo 配置读成对象
 * （macOS 上用 `plutil -convert json`），这样门禁逻辑在任何机器上都能跑测试，不必
 * 有一台 Mac 才能验证"门禁本身对不对"。
 */

/**
 * exportOptionsPlist 生成 `xcodebuild -exportArchive` 的导出选项。
 *
 * 只支持 app-store-connect：这套流程的出口就是 TestFlight / App Store。ad-hoc 与
 * enterprise 都不是普通用户能扫码装的东西（设计 §2），留在这里只会让人以为可以选。
 *
 * uploadSymbols 开着：崩溃日志没有符号表等于没有。
 *
 * ## signingStyle 为什么从 automatic 改成 manual
 *
 * automatic 的前提是 Xcode 手里有一把能申请描述文件的 App Store Connect Key。而打包机上
 * 跑构建的那个进程要执行几千个第三方依赖——一把能申请描述文件的 Key 同时也能上传 build、
 * 注册设备、建 Ad Hoc 描述文件，于是"这台机器只能签、不能发"就不成立了
 * （RN-Server 设计 ios-mac-builders-home-network-2026-09-18 §4.3）。
 *
 * 所以证书与描述文件改成由人放到机器上，构建过程一把 Key 都不拿。手工签名时
 * `xcodebuild -exportArchive` **只有 manual 才认** provisioningProfiles 这个字典：
 * 传了 profileName 却留着 automatic，导出会去找 Xcode 账户、在无人值守的机器上卡住。
 *
 * 开发者在自己的 Mac 上手工跑时不传 profileName，仍然是 automatic。
 *
 * @param {object} args
 * @param {string} args.teamId       10 位 Apple Team ID
 * @param {string} [args.bundleId]   手工签名时必给：描述文件按 bundle id 索引
 * @param {string} [args.profileName] 描述文件的**名字**（不是文件名），手工签名时必给
 */
export function exportOptionsPlist({ teamId, bundleId, profileName }) {
  if (!/^[A-Z0-9]{10}$/.test(String(teamId ?? "")))
    throw new Error(
      "exportOptionsPlist requires the 10-character Apple Developer Team ID",
    );
  const manual = Boolean(profileName);
  if (manual && !bundleId)
    throw new Error(
      "exportOptionsPlist needs the bundle id to map it to the provisioning profile",
    );
  const provisioning = manual
    ? `  <key>provisioningProfiles</key>
  <dict>
    <key>${bundleId}</key>
    <string>${profileName}</string>
  </dict>
`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>teamID</key>
  <string>${teamId}</string>
  <key>signingStyle</key>
  <string>${manual ? "manual" : "automatic"}</string>
${provisioning}  <key>uploadSymbols</key>
  <true/>
  <key>stripSwiftSymbols</key>
  <true/>
  <key>destination</key>
  <string>export</string>
</dict>
</plist>
`;
}

const text = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * iosArtifactProblems 逐条比对产物与租户配置，返回问题清单（空数组=通过）。
 *
 * 返回清单而不是抛第一条：一次构建要跑十几分钟，让人一次看到全部问题，
 * 而不是修一条重跑一次。
 *
 * @param {object} args
 * @param {object} args.infoPlist    产物里的 Info.plist（已解析成对象）
 * @param {object} args.entitlements 产物的 entitlements（已解析成对象）
 * @param {object} args.expoConfig   `expo config --json` 在 EXPO_OS=ios 下的输出
 * @param {object} args.tenant       tenants/<slug>/tenant.json
 * @param {string} args.appLinkHost  通用链接的域名（从 apiBaseUrl 推出）
 */
export function iosArtifactProblems({
  infoPlist,
  entitlements,
  expoConfig,
  tenant,
  appLinkHost,
}) {
  const problems = [];
  const expect = (label, actual, wanted) => {
    if (text(actual) !== text(wanted))
      problems.push(
        `${label}: ${JSON.stringify(actual)}，应为 ${JSON.stringify(wanted)}`,
      );
  };

  expect(
    "CFBundleIdentifier",
    infoPlist?.CFBundleIdentifier,
    tenant.iosBundleId,
  );
  expect(
    "CFBundleShortVersionString",
    infoPlist?.CFBundleShortVersionString,
    tenant.version,
  );
  expect("CFBundleVersion", infoPlist?.CFBundleVersion, tenant.iosBuildNumber);

  // ---- §3.2.2 的那条：EXPO_OS 漏设时这里是唯一会响的警报 ----
  //
  // app.config.ts 用 `process.env.EXPO_OS === "ios"` 决定 extra.buildNumber 与
  // OTA 请求头取 iosBuildNumber 还是 androidVersionCode，而 @expo/cli 的 prebuild
  // 不设这个变量。漏设的后果全在别处：Info.plist 里的 CFBundleVersion 是对的
  // （它来自 ios.buildNumber），运行时的 X-Build-Number 也是对的（它读
  // Application.nativeBuildVersion），只有 OTA 那条链错——manifest 里内嵌的目标包
  // 身份与本机对不上，于是**所有 iOS 热更新被静默判定为"不属于本机"**。
  // 设备上看不出任何异常，只是永远收不到更新。
  const embeddedBuildNumber = expoConfig?.extra?.buildNumber;
  expect(
    "内嵌 extra.buildNumber（EXPO_OS 漏设时会变成 Android 的 versionCode）",
    embeddedBuildNumber,
    infoPlist?.CFBundleVersion,
  );
  const otaBuildNumber =
    expoConfig?.updates?.requestHeaders?.["x-build-number"];
  if (expoConfig?.updates?.enabled !== false)
    expect(
      "OTA 请求头 x-build-number",
      otaBuildNumber,
      infoPlist?.CFBundleVersion,
    );

  // ---- 身份与服务端指向 ----
  expect(
    "Expo 配置里的 bundleIdentifier",
    expoConfig?.ios?.bundleIdentifier,
    tenant.iosBundleId,
  );
  expect("内嵌 apiBaseUrl", expoConfig?.extra?.apiBaseUrl, tenant.apiBaseUrl);
  expect(
    "内嵌 distributionChannel",
    expoConfig?.extra?.distributionChannel,
    tenant.distributionChannel,
  );

  // ---- 权限文案：缺了不是弹窗被拒，是进程直接终止 ----
  for (const [key, why] of [
    ["NSFaceIDUsageDescription", "生物识别解锁"],
    ["NSCameraUsageDescription", "扫收款地址二维码"],
  ]) {
    if (!text(infoPlist?.[key]))
      problems.push(
        `Info.plist 缺 ${key}（${why}）：iOS 会在首次调用时直接终止进程`,
      );
  }

  // ---- 通用链接：不声明的话 WalletConnect 回跳退回可抢注的自定义 scheme ----
  const domains =
    entitlements?.["com.apple.developer.associated-domains"] ?? [];
  if (appLinkHost && !domains.includes(`applinks:${appLinkHost}`))
    problems.push(
      `entitlements 缺 applinks:${appLinkHost}：通用链接不生效，回跳会退回自定义 scheme（安全评审 N13）`,
    );

  // ---- 出口合规：值由租户法务给，工程不替它回答（设计 §8.2）----
  if (infoPlist && "ITSAppUsesNonExemptEncryption" in infoPlist)
    problems.push(
      "Info.plist 写死了 ITSAppUsesNonExemptEncryption：这是租户的法务判断，错误声明的后果落在租户主体上。" +
        "拿到书面答复之前留空，每次上传在 App Store Connect 网页上人工回答（设计 §8.2）",
    );

  return problems;
}

/**
 * appLinkHostOf 从 apiBaseUrl 推通用链接的域名，与 app.config.ts 同源。
 * 非 https 返回空串：本地开发没有通用链接。
 */
/**
 * embeddedPlist 从 `.mobileprovision` 的字节里切出那份 XML plist。
 *
 * 它是个 CMS 签名块，中间包着一份 plist。**不用 `security cms -D`**：那条命令会把签名者
 * 证书往**默认钥匙串**里导，而构建跑在任务自己的 HOME 下、那里没有 login 钥匙串，于是
 * （2026-09-20 真机，CocoaPods 装完之后的下一步）：
 *
 *   security: cert import failed: Write permissions error.
 *   security: problem decoding
 *
 * 也不需要验那个签名：描述文件是 root 以 0600 装进签名区的，来源已经可信，而原先那条
 * 命令的输出本来也是照单全收。构建机那一侧的盘点就是这么读的
 * （RN-Server `cmd/build-agent/ios_inventory.go`）。
 *
 * 入参是按 **latin1** 读进来的字符串：latin1 是字节到码位的一一映射，切出来再以 latin1
 * 写回去字节不变；用 utf8 读会把前后那些二进制字节换成替换字符。
 */
export function embeddedPlist(raw, path = ".mobileprovision") {
  const start = raw.indexOf("<?xml");
  const end = raw.lastIndexOf("</plist>");
  if (start < 0 || end < 0 || end < start)
    throw new Error(
      `${path} 里找不到描述文件的 plist：它应当是一个 CMS 签名块，中间包着 <?xml … </plist>`,
    );
  return raw.slice(start, end + "</plist>".length);
}

export function appLinkHostOf(apiBaseUrl) {
  if (!String(apiBaseUrl ?? "").startsWith("https://")) return "";
  return new URL(apiBaseUrl).host;
}
