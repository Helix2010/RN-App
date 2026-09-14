import { now } from "../time/clock";
import { buildCrashSnapshot, writeCrashSnapshot } from "./crash-snapshot";
import { logEvent } from "./log-buffer";
import { currentBuild } from "./report-service";

/**
 * 崩溃进诊断日志的唯一入口（设计 diagnostic-report-2026-09-14 §4.2 / §4.5）。
 *
 * 两个来源：根错误边界（渲染期异常，App 还活着）与全局未捕获异常（可能是致命的）。
 * 崩溃快照的持久化与下次启动的自动上报也挂在这里——所以两个来源必须走同一个函数，
 * 不能各记各的。
 */
export type CrashSource = "render" | "global";

/**
 * componentStack 的第一帧组件名。只取名字，不取整帧：帧里带着文件路径，
 * 开发构建下是含用户名的绝对路径。完整栈留给崩溃快照。
 *
 * React 19 的格式是 "\n    at Foo (/path/file.tsx:3:37)"；更早的是
 * "\n    in Foo (at file.tsx:3)"。两种都认。
 */
function topComponent(componentStack: string | undefined): string | undefined {
  return componentStack?.match(/(?:^|\n)\s*(?:at|in) ([A-Za-z0-9_$.]+)/)?.[1];
}

export function recordCrash(
  source: CrashSource,
  error: unknown,
  options: { componentStack?: string; fatal?: boolean } = {},
): void {
  const name = error instanceof Error ? error.name : "NonErrorThrown";
  // message 会过 logEvent 的出口扫描；这里是少数允许记 message 的地方——
  // 崩溃不带消息就没法排查。它和 componentStack 一样不受我们控制，所以才需要那道网
  const message = error instanceof Error ? error.message : "";
  const component = topComponent(options.componentStack);
  logEvent("error", "crash", `${name}: ${message}`, {
    source,
    ...(options.fatal !== undefined ? { fatal: options.fatal } : {}),
    ...(component ? { component } : {}),
  });
  // 只有渲染崩溃和致命错误留快照给下次启动（设计 §4.5）。非致命的未捕获异常只进日志：
  // 它们不会让用户看到崩溃，给每一个都留快照等于让下次启动为一个小异常自动上报一次
  if (source === "render" || options.fatal === true) {
    const stack = error instanceof Error ? error.stack : undefined;
    void writeCrashSnapshot(
      buildCrashSnapshot({
        at: now(),
        source,
        error,
        stack: stack ?? options.componentStack,
        app: currentBuild(),
      }),
    );
  }
}

let installed = false;

/**
 * 接管全局未捕获异常。**串联**原来的处理器：RN 自己的红屏与致命崩溃行为必须照旧，
 * 这里只是在它之前记一笔。重复调用无副作用（热重载会让模块顶层再跑一遍）。
 */
export function installGlobalCrashCapture(): void {
  if (installed || typeof ErrorUtils === "undefined") return;
  installed = true;
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    try {
      recordCrash("global", error, { fatal: isFatal === true });
    } catch {
      // 记录失败绝不能挡住原处理器
    }
    previous(error, isFatal);
  });
}

/** 仅测试用：让下一次 install 重新接管。 */
export function resetCrashCaptureForTest(): void {
  installed = false;
}

/**
 * 路由切换记录器：只记路由名，连续相同的不重复记。
 *
 * **不记 params**：参数里有事件 ID、金额、收款地址（设计 §4.2）。
 */
export function createRouteLogger(): (name: string | undefined) => void {
  let last: string | undefined;
  return (name) => {
    if (!name || name === last) return;
    last = name;
    logEvent("info", "nav", "route", { name });
  };
}
