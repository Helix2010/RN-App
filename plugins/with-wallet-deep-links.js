const { withAndroidManifest } = require("expo/config-plugins");

/**
 * 让 App 能探测到外部钱包是否安装。
 *
 * Android 11(API 30) 起有 package visibility 过滤：`Linking.canOpenURL` 走的是
 * `Intent.resolveActivity(packageManager)`，对**没有在 `<queries>` 里声明**的
 * package / scheme 一律返回 null —— 哪怕钱包就装在机器上。少了这段声明，
 * "已安装的 MetaMask" 也会被判成没装，唤起深链于是永远回退到二维码，用户点了
 * 像没反应。
 *
 * 注意这只影响"查询"。`openURL`（startActivity）不受 package visibility 限制，
 * 所以唤起动作本身不应该依赖 canOpenURL 的结果，见 walletconnect-client.ts。
 *
 * package 与 scheme 取自 Reown 官方钱包注册表（钱包厂商自己提交的数据）：
 * https://explorer-api.walletconnect.com/v3/wallets
 */

/** OKX 有两个 App：交易所主 App 和独立的 Web3 钱包，scheme 与包名都不同。 */
const WALLET_PACKAGES = [
  "io.metamask",
  "com.okinc.okex.gp",
  "com.okx.wallet",
  "com.wallet.crypto.trustapp",
];

const WALLET_SCHEMES = ["metamask", "okex", "okx", "okxwallet", "trust", "wc"];

function mergeQueries(queries) {
  const existing = queries[0] ?? {};
  const packages = existing.package ?? [];
  const intents = existing.intent ?? [];
  const declared = new Set(
    packages.map((item) => item.$?.["android:name"]).filter(Boolean),
  );
  for (const name of WALLET_PACKAGES) {
    if (declared.has(name)) continue;
    packages.push({ $: { "android:name": name } });
  }
  const declaredSchemes = new Set(
    intents
      .flatMap((intent) => intent.data ?? [])
      .map((data) => data.$?.["android:scheme"])
      .filter(Boolean),
  );
  for (const scheme of WALLET_SCHEMES) {
    if (declaredSchemes.has(scheme)) continue;
    intents.push({
      action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
      data: [{ $: { "android:scheme": scheme } }],
    });
  }
  return [{ ...existing, package: packages, intent: intents }];
}

module.exports = function withWalletDeepLinks(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest.queries = mergeQueries(manifest.queries ?? []);
    return config;
  });
};

module.exports.WALLET_PACKAGES = WALLET_PACKAGES;
module.exports.WALLET_SCHEMES = WALLET_SCHEMES;
module.exports.mergeQueries = mergeQueries;
