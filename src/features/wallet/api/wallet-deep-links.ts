import type { WalletConnectorId } from "../../session/model/session";

/**
 * 外部钱包的深链地址。**唯一真相源**，连接（带 wc URI）和签名（把用户切过去）
 * 都从这里取。
 *
 * 数据取自 Reown 官方钱包注册表（钱包厂商自己提交）：
 * https://explorer-api.walletconnect.com/v3/wallets
 *
 * 每个钱包是一个候选列表而不是单个地址：OKX 有两个 App（交易所主 App 与独立的
 * Web3 钱包），scheme 不同，装哪个都要能唤起，所以按顺序试。
 */
const WALLET_NATIVE_LINKS: Partial<Record<WalletConnectorId, string[]>> = {
  metamask: ["metamask://"],
  // okx:// 这个 scheme 并不存在，注册表里是 okex://main 和 okxwallet://main
  okx: ["okex://main", "okxwallet://main"],
  trust: ["trust://"],
};

/** 唤起钱包并带上配对 URI。 */
export function pairingLinks(connector: WalletConnectorId): string[] {
  return (WALLET_NATIVE_LINKS[connector] ?? []).map(
    (link) => `${link}${link.endsWith("/") ? "" : "/"}wc?uri=`,
  );
}

/** 只把用户切到钱包（签名请求已经通过 relay 发过去了）。 */
export function launchLinks(connector: WalletConnectorId): string[] {
  return WALLET_NATIVE_LINKS[connector] ?? [];
}

/**
 * 用来探测"这个钱包装了没"，需要 AndroidManifest 的 queries 声明配合。
 *
 * 返回所有候选：OKX 的两个 App 装哪个都算装了，只探第一个会把只装了独立
 * 钱包 App 的用户误标成"未安装"。
 */
export function probeLinks(connector: WalletConnectorId): string[] {
  return WALLET_NATIVE_LINKS[connector] ?? [];
}
