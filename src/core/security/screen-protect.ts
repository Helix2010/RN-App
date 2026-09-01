import * as ScreenCapture from "expo-screen-capture";
import { useEffect } from "react";

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
] as const;

type ProtectedFlow = (typeof PROTECTED_FLOWS)[number];

/**
 * 进入页面时加保护，离开时释放。
 *
 * 用 tag 而不是无参调用：`expo-screen-capture` 的 tag 机制保证两个受保护页面
 * 叠在一起时，先离开的那个不会把还在前台的那个的保护也一起撤掉。
 */
export function useScreenProtect(flow: ProtectedFlow): void {
  useEffect(() => {
    let released = false;
    void ScreenCapture.preventScreenCaptureAsync(flow).catch(() => {
      // 某些设备 / 模拟器不支持；不能因此让用户看不到助记词
    });
    return () => {
      if (released) return;
      released = true;
      void ScreenCapture.allowScreenCaptureAsync(flow).catch(() => {});
    };
  }, [flow]);
}
