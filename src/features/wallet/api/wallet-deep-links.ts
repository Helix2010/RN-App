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

/** 唤起钱包并带上配对 URI。 */
export function pairingLinks(connector: WalletConnectorId): string[] {
  return (WALLET_NATIVE_LINKS[connector] ?? []).map((link) => link.pairing);
}

/** 只把用户切到钱包（签名请求已经通过 relay 发过去了）。 */
export function launchLinks(connector: WalletConnectorId): string[] {
  return (WALLET_NATIVE_LINKS[connector] ?? []).map((link) => link.launch);
}

/**
 * 用来探测"这个钱包装了没"，需要 AndroidManifest 的 queries 声明配合。
 *
 * 返回所有候选：OKX 的两个 App 装哪个都算装了，只探第一个会把只装了独立
 * 钱包 App 的用户误标成"未安装"。
 */
export function probeLinks(connector: WalletConnectorId): string[] {
  return (WALLET_NATIVE_LINKS[connector] ?? []).map((link) => link.launch);
}
