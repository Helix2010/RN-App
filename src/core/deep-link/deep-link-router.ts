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

type DeepLink =
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
    //
    // 两处必须归一，否则规范写法会被判成 unknown：
    //  - `anyfun:///app/invite/X`（三斜杠）的 host 是空串，拼出来是 `//app/...`，
    //    所以要把连续斜杠折成一个。三斜杠正是 `Linking.createURL('/…')` 的产出形态。
    //  - 非特殊 scheme 的 host **不做小写归一**（`anyfun://APP/...` 的 host 就是 `APP`），
    //    所以这里自己小写。只小写 host，路径其余部分原样——邀请码大小写交服务端归一。
    path =
      parsed.protocol === "http:" || parsed.protocol === "https:"
        ? parsed.pathname
        : `/${parsed.host.toLowerCase()}${parsed.pathname}`.replace(
            /\/{2,}/g,
            "/",
          );
  } catch {
    return { kind: "unknown" };
  }
  if (
    path === WALLET_CONNECT_PATH ||
    path.startsWith(`${WALLET_CONNECT_PATH}/`)
  )
    return { kind: "walletconnect" };
  if (path.startsWith(INVITE_PATH_PREFIX)) {
    // 前缀之后的第一段就是邀请码原文；**归一化在服务端做**，这里不 trim、
    // 不大写、不做字符映射——那会变成第二份真相
    const rest = path.slice(INVITE_PATH_PREFIX.length);
    let code: string;
    try {
      code = decodeURIComponent(rest.split("/")[0] ?? "");
    } catch {
      // 残缺的百分号转义
      return { kind: "unknown" };
    }
    if (!isPlausibleInviteCode(code)) return { kind: "unknown" };
    return { kind: "invite", code };
  }
  return { kind: "unknown" };
}

/**
 * 邀请码原文的边界校验（AGENTS.md「安全与隐私」：深链参数必须在边界校验）。
 *
 * **这不是归一化**，是拒绝明显不成形的输入。不做长度精确判定、不判字母表——
 * 那些是服务端 `referral.Normalize` 的事，在这里重写一遍就是第二份真相
 * （合法原文可以带分隔符、全角字符，长度本来就不等于 8）。
 *
 * 这里只挡两类东西：
 *  - 长到不可能是人抄下来的码。没有这道闸，一条构造的链接能把任意长的串
 *    写进 AsyncStorage，并放进那个承诺"绑定后永久不可解除"的确认弹层里。
 *  - 控制字符。URL 路径里不会出现，但百分号转义解出来会——它们进不了邀请码，
 *    却能把确认文案撑坏。
 */
const MAX_RAW_INVITE_CODE_LENGTH = 64;

function isPlausibleInviteCode(code: string): boolean {
  if (code === "" || code.length > MAX_RAW_INVITE_CODE_LENGTH) return false;
  return !/[\u0000-\u001f\u007f]/.test(code);
}
