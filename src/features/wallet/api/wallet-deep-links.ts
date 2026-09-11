import type { WalletConnectorId } from "../../session/model/session";

/**
 * 外部钱包的深链地址。**唯一真相源**，连接（带 wc URI）和签名（把用户切过去）
 * 都从这里取。
 *
 * 数据取自 Reown 官方钱包注册表（钱包厂商自己提交）：
 * https://explorer-api.walletconnect.com/v3/wallets
 *
 * 每个钱包是一个候选列表而不是单个地址：OKX 大陆版、国际版和独立钱包的 scheme
 * 与参数名不同，装哪个都要能唤起，所以按顺序试。
 */
type WalletNativeLink = {
  launch: string;
  pairing: string;
};

/**
 * 通用链接（Android App Links / iOS Universal Links）。
 *
 * 自定义 scheme 谁都能在自己的 manifest 里声明，装了恶意应用的机器上，
 * `metamask://wc?uri=` 可能被它接走，配对 URI 就落到别人手里（安全评审 N13）。
 * 通用链接绑定在钱包厂商自己的域名上，域名的 `assetlinks.json` / AASA 决定
 * 谁能接管，抢注不了。系统在没装钱包时会退回浏览器打开该域名的引导页，
 * 也比"点了没反应"好。
 *
 * 先试通用链接，再退回自定义 scheme：部分旧版本钱包只注册了 scheme。
 */
const WALLET_UNIVERSAL_LINKS: Partial<
  Record<WalletConnectorId, WalletNativeLink[]>
> = {
  metamask: [
    {
      launch: "https://metamask.app.link/",
      pairing: "https://metamask.app.link/wc?uri=",
    },
  ],
  trust: [
    {
      launch: "https://link.trustwallet.com/",
      pairing: "https://link.trustwallet.com/wc?uri=",
    },
  ],
};

const WALLET_NATIVE_LINKS: Partial<
  Record<WalletConnectorId, WalletNativeLink[]>
> = {
  metamask: [{ launch: "metamask://", pairing: "metamask://wc?uri=" }],
  // 欧易大陆版 6.187.1 的 WalletConnect 入口使用 requestId；独立 OKX Wallet
  // 仍使用 okxwallet://main/wc?uri=，不能把不同客户端混成同一种参数。
  okx: [
    { launch: "okex://main", pairing: "okex://main/wc?requestId=" },
    { launch: "okx://main", pairing: "okx://main/wc?requestId=" },
    { launch: "okxwallet://main", pairing: "okxwallet://main/wc?uri=" },
  ],
  trust: [{ launch: "trust://", pairing: "trust://wc?uri=" }],
};

function linksFor(connector: WalletConnectorId): WalletNativeLink[] {
  return [
    ...(WALLET_UNIVERSAL_LINKS[connector] ?? []),
    ...(WALLET_NATIVE_LINKS[connector] ?? []),
  ];
}

/** 唤起钱包并带上配对 URI。通用链接优先，自定义 scheme 兜底。 */
export function pairingLinks(connector: WalletConnectorId): string[] {
  return linksFor(connector).map((link) => link.pairing);
}

/** 只把用户切到钱包（签名请求已经通过 relay 发过去了）。 */
export function launchLinks(connector: WalletConnectorId): string[] {
  return linksFor(connector).map((link) => link.launch);
}

/**
 * Android 上唤起钱包时要带的显式包名（安全评审 N13）。
 *
 * 隐式 `Intent.ACTION_VIEW` 由系统按 intent filter 选接收方，装了恶意应用的
 * 机器上，它可以声明同样的 scheme / host 把配对 URI 接走。带上包名后目标只
 * 可能是这个应用本身。包名与 `plugins/with-wallet-deep-links.js` 的 `<queries>`
 * 声明一致 —— Android 11+ 要求先能"看见"这个包才允许显式启动它。
 *
 * OKX 有两个 App（交易所主 App 与独立 Web3 钱包），按顺序试。
 */
const WALLET_ANDROID_PACKAGES: Partial<Record<WalletConnectorId, string[]>> = {
  metamask: ["io.metamask"],
  okx: ["com.okinc.okex.gp", "com.okx.wallet"],
  trust: ["com.wallet.crypto.trustapp"],
};

/** 这个钱包在 Android 上的候选包名；未知钱包返回空数组（退回隐式启动）。 */
export function androidPackages(connector: WalletConnectorId): string[] {
  return WALLET_ANDROID_PACKAGES[connector] ?? [];
}

/**
 * 用来探测"这个钱包装了没"，需要 AndroidManifest 的 queries 声明配合。
 *
 * 返回所有候选：OKX 的两个 App 装哪个都算装了，只探第一个会把只装了独立
 * 钱包 App 的用户误标成"未安装"。
 */
export function probeLinks(connector: WalletConnectorId): string[] {
  // 探测只用自定义 scheme：`canOpenURL("https://…")` 在装了浏览器的机器上
  // 恒为 true，拿它判断"钱包装了没"会把所有人都标成已安装。
  return (WALLET_NATIVE_LINKS[connector] ?? []).map((link) => link.launch);
}
