import { useState, useSyncExternalStore } from "react";
import { now } from "./clock";

// 所有倒计时共用一个秒表：多少个订阅者都只有一个 setInterval，最后一个走了就停。
// `latest` 是秒表最近一次读到的"现在"；开表时先刷新一次，订阅者第一帧就拿到新值。
const tickListeners = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;
let latest = now();

function tick(): void {
  latest = now();
  for (const notify of tickListeners) notify();
}

export function subscribeTick(listener: () => void): () => void {
  tickListeners.add(listener);
  if (tickTimer === null) {
    latest = now();
    tickTimer = setInterval(tick, 1_000);
  }
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

const readLatest = () => latest;
const subscribeNothing = () => () => {};

/**
 * 渲染用的"现在"。
 * - `ticking=true`：每秒刷新，走 `useSyncExternalStore`，订阅开始时立刻拿到新值（面板打开、tab 切回都不会先闪旧时间）；
 * - 默认 `false`：只在挂载时取一次，给"3 天后截止"这类不需要秒级刷新的文案用；卡片重挂载即刷新。
 */
export function useNow(ticking = false): number {
  const [mounted] = useState(now);
  const live = useSyncExternalStore(
    ticking ? subscribeTick : subscribeNothing,
    readLatest,
    readLatest,
  );
  return ticking ? live : mounted;
}
