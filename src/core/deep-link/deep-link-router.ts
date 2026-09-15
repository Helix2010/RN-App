/**
 * 入站深链的统一分发（设计 referral-graph-2026-09-15 §5.3）。
 *
 * 这套是新建的：在此之前全仓只有 `Linking.openURL` / `openSettings`，
 * 没有任何 `getInitialURL` 或 `url` 事件监听。
 *
 * **一个 dispatcher**，`/app/wc`（WalletConnect 回跳）与 `/app/invite/`
 * 在同一处按路径分发。起两套并行监听会让两个功能互相吃掉对方的链接，
 * 而且谁先注册谁生效这种事排查起来极其痛苦。
 */

/** 邀请链接的路径前缀。**带尾斜杠**，与服务端和 app.config.ts 的 pathPrefix 一致。 */
export const INVITE_PATH_PREFIX = "/app/invite/";

/** WalletConnect 回跳路径。这里只负责认出它，处理仍在 WalletConnect 自己那条链路。 */
export const WALLET_CONNECT_PATH = "/app/wc";

export type DeepLink =
  | { kind: "invite"; code: string }
  | { kind: "walletconnect" }
  | { kind: "unknown" };

/**
 * 解析一条入站链接。
 *
 * 只认 https 深链（App Links）与自定义 scheme 的同名路径；认不出来返回 unknown，
 * 由调用方忽略——不猜、不做模糊匹配。
 */
export function parseDeepLink(url: string): DeepLink {
  let path: string;
  try {
    const parsed = new URL(url);
    // 自定义 scheme（anyfun://app/invite/X）会把第一段解析成 host，
    // pathname 只剩 /invite/X。拼回去，两种 scheme 走同一套路径判断。
    path =
      parsed.protocol === "http:" || parsed.protocol === "https:"
        ? parsed.pathname
        : `/${parsed.host}${parsed.pathname}`;
  } catch {
    return { kind: "unknown" };
  }
  if (
    path === WALLET_CONNECT_PATH ||
    path.startsWith(`${WALLET_CONNECT_PATH}/`)
  )
    return { kind: "walletconnect" };
  if (path.startsWith(INVITE_PATH_PREFIX)) {
    // 前缀之后的第一段就是邀请码原文；归一化在服务端做
    const rest = path.slice(INVITE_PATH_PREFIX.length);
    const code = decodeURIComponent(rest.split("/")[0] ?? "");
    if (code === "") return { kind: "unknown" };
    return { kind: "invite", code };
  }
  return { kind: "unknown" };
}
