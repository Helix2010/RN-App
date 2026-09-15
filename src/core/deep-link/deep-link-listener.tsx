import { useEffect } from "react";
import { Linking } from "react-native";
import { logEvent } from "../diagnostics/log-buffer";
import { parseDeepLink } from "./deep-link-router";
import { usePendingInviteStore } from "./pending-invite-store";

/**
 * 入站深链的唯一监听点（设计 referral-graph-2026-09-15 §5.3）。
 *
 * 冷启动读 `getInitialURL()`，热启动听 `url` 事件，两条都汇到同一个
 * `parseDeepLink`。起两套并行监听会让功能互相吃掉对方的链接。
 *
 * 这里**只暂存，不导航、不绑定**。原因是到达时机与 App 的状态无关：
 * bootstrap 可能还没就绪（不知道租户开没开邀请）、可能正锁着屏
 * （`AppLockGate` 是不可关闭的全屏 Modal）、可能还没登录。把这些时序
 * 判断塞进监听器就得在这里重建半个应用状态机。邀请页拿到暂存后再决定
 * 弹不弹确认（按 `PENDING_INVITE_TTL_MS` 判新鲜度），它天然在解锁、登录、
 * 配置都就绪之后。
 *
 * WalletConnect 的回跳被识别出来但不在这里处理：它由 WalletConnect SDK
 * 自己那条链路消费，这里认出它只是为了不把它误当成别的东西。
 */
export function DeepLinkListener() {
  const remember = usePendingInviteStore((state) => state.remember);

  useEffect(() => {
    const handle = (url: string | null, entry: "cold" | "warm"): void => {
      if (!url) return;
      const link = parseDeepLink(url);
      // 暂存的写入记一条本地事件（设计 §5.3）。事后排查"我点了链接却没弹确认"
      // 只能靠这条：到达时机跨了冷启动、解锁、登录三段，没有留痕就无从下手。
      // **不记邀请码本身**，记形态就够定位了
      logEvent("info", "nav", "deep link received", {
        kind: link.kind,
        entry,
        codeLength: link.kind === "invite" ? link.code.length : 0,
      });
      if (link.kind === "invite") remember(link.code);
    };
    // 冷启动：应用是被这条链接拉起来的
    void Linking.getInitialURL().then((url) => handle(url, "cold"));
    // 热启动：应用已经在后台，系统把链接送进来
    const subscription = Linking.addEventListener("url", (event) =>
      handle(event.url, "warm"),
    );
    return () => subscription.remove();
  }, [remember]);

  return null;
}
