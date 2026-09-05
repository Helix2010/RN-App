export type AppTab =
  "home" | "predict" | "positions" | "dex" | "market" | "swap" | "assets";

export function resolveAppShellBack(tab: AppTab): "home" | "consume" {
  return tab === "home" ? "consume" : "home";
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
