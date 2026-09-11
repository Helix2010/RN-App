import * as ScreenCapture from "expo-screen-capture";
import { useEffect, useState } from "react";

/**
 * 敏感界面的防截屏 / 防录屏。
 *
 * 对应 Robinhood 的中央 `ScreenProtectManager`（逆向 E-019 / F-002）：把
 * `FLAG_SECURE` 只加在一份**明确列出**的敏感流程上，而不是全局开——全局开会
 * 影响正常截图分享，只开个别页面又容易漏。
 *
 * Android 的 `FLAG_SECURE` 同时挡住系统截图与程序化抓屏（包括埋点 SDK 的录屏），
 * iOS 只能拦截截图事件。
 */
export const PROTECTED_FLOWS = [
  /** 助记词展示与校验 */
  "wallet-seed-phrase",
  /** 助记词 / 私钥导入 */
  "wallet-key-import",
  /** WalletConnect 配对二维码：扫走它就等于把配对权交给别人 */
  "wallet-pairing-qr",
  /** 登录签名确认：展示待签消息与账户 */
  "wallet-sign-confirm",
  /** 转出确认：完整收款地址与金额，最后一道可见防线 */
  "wallet-send-confirm",
] as const;

type ProtectedFlow = (typeof PROTECTED_FLOWS)[number];

/**
 * 保护是否真的生效。
 * - `pending` 还在向系统申请；
 * - `on` 已生效；
 * - `unavailable` 这台设备做不到（模拟器、部分定制系统）。
 *
 * 之所以要把 `unavailable` 交出去而不是内部吞掉：用户以为这一页截不了图，
 * 实际上截得了，这个差别必须让他知道（安全评审 N24）。
 */
export type ScreenProtectStatus = "pending" | "on" | "unavailable";

/**
 * 应用切换器里的隐私遮罩。系统在切后台时会给最近任务列表截一张缩略图，
 * 那张图里可能正好是助记词或收款地址；`FLAG_SECURE` 只管当前窗口，管不到它。
 * 启动时开一次，全程有效（安全评审 N24）。
 */
export async function enableAppSwitcherProtection(): Promise<boolean> {
  try {
    await ScreenCapture.enableAppSwitcherProtectionAsync();
    return true;
  } catch {
    // 平台不支持（部分 Android 版本）时不影响任何功能，如实返回 false
    return false;
  }
}

/**
 * 进入页面时加保护，离开时释放。
 *
 * 用 tag 而不是无参调用：`expo-screen-capture` 的 tag 机制保证两个受保护页面
 * 叠在一起时，先离开的那个不会把还在前台的那个的保护也一起撤掉。
 *
 * @param active 传 false 表示这一刻不需要保护（常驻挂载、按状态显示的 sheet）
 */
export function useScreenProtect(
  flow: ProtectedFlow,
  active = true,
): ScreenProtectStatus {
  const [status, setStatus] = useState<ScreenProtectStatus>("pending");
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void ScreenCapture.preventScreenCaptureAsync(flow)
      .then(() => {
        if (!cancelled) setStatus("on");
      })
      .catch(() => {
        // 某些设备 / 模拟器不支持；不能因此让用户看不到助记词，但要如实标记
        if (!cancelled) setStatus("unavailable");
      });
    return () => {
      cancelled = true;
      void ScreenCapture.allowScreenCaptureAsync(flow).catch(() => {});
    };
  }, [flow, active]);
  // 不保护的时候不报告状态：调用方据此不显示"保护未生效"的提示
  return active ? status : "pending";
}
