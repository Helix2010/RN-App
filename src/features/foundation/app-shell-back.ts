export type AppTab =
  | "home"
  | "predict"
  | "positions"
  | "dex"
  | "market"
  | "swap"
  | "assets"
  // 只在 Wallet-only（00）时作为底部页签出现；其它组合里它们是栈内页面
  | "records"
  | "profile";

/**
 * 壳层里的返回：在主页签上消费掉（Android 再按一次才退出），其它页签回主页签。
 *
 * 主页签由 `defaultAppTab` 按模块组合决定，不写死 `"home"`——`00` 下没有 home。
 */
export function resolveAppShellBack(
  tab: AppTab,
  mainTab: AppTab,
): AppTab | "consume" {
  return tab === mainTab ? "consume" : mainTab;
}

/** 连续两次返回（边缘滑动 / 返回键）之间的最长间隔：超过就当作新的第一次 */
export const EXIT_CONFIRM_WINDOW_MS = 2_000;

/**
 * 首页上的返回：第一次只提示"再滑一次退出"，`EXIT_CONFIRM_WINDOW_MS` 内再来一次才退出。
 * 纯函数：`lastAttemptAt` 是上一次提示的时刻，null 表示还没提示过。
 */
export function resolveExitAttempt(
  lastAttemptAt: number | null,
  nowMs: number,
): "exit" | "hint" {
  if (lastAttemptAt !== null && nowMs - lastAttemptAt <= EXIT_CONFIRM_WINDOW_MS)
    return "exit";
  return "hint";
}
