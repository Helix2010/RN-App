import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useRef } from "react";
import { copyToClipboard } from "./copy-to-clipboard";

/** 机密内容在剪贴板里最多停留这么久 */
export const CLIPBOARD_TTL_MS = 60_000;

/**
 * 复制机密内容（助记词、WalletConnect 配对 URI）并按时抹掉（安全评审 N23）。
 *
 * 三条约束，缺一条都出问题：
 * - **要抹**：剪贴板是系统级的，任何应用都能读，机密不能一直躺在里面。
 * - **抹之前要比对**：用户这段时间里可能复制了别的东西，直接清空清掉的是
 *   用户自己的内容。
 * - **离开页面要立刻抹**，不能只取消定时器：那样用户在 TTL 内退出，机密就
 *   无限期留在剪贴板里，比不做还糟。
 */
export function useScrubbedClipboard(ttlMs: number = CLIPBOARD_TTL_MS): {
  copy: (
    value: string,
    messages: { success: string; failure: string },
  ) => Promise<void>;
} {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copied = useRef<string | null>(null);

  const scrub = useCallback(() => {
    const value = copied.current;
    if (value === null) return;
    copied.current = null;
    void Clipboard.getStringAsync()
      .then((current) =>
        current === value ? Clipboard.setStringAsync("") : undefined,
      )
      .catch(() => {
        // 读不到剪贴板（权限 / 平台限制）时不猜内容，宁可不清也不误删
      });
  }, []);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      scrub();
    },
    [scrub],
  );

  const copy = useCallback(
    async (value: string, messages: { success: string; failure: string }) => {
      await copyToClipboard(value, messages);
      copied.current = value;
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        scrub();
      }, ttlMs);
    },
    [scrub, ttlMs],
  );

  return { copy };
}
