import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { AppError } from "../network/app-error";

/**
 * Mock 运行时：所有 Mock 网关共用的延迟 / 失败 / 空态 / 离线 / 时间加速开关。
 * 只在 development / staging 暴露开发面板；生产包默认值即"真实感演示"。
 */
export type MockRuntimeState = {
  minDelayMs: number;
  maxDelayMs: number;
  /** 0–1，每次调用按此概率抛出可重试的 server 错误 */
  failureRate: number;
  /** 列表类返回空数组，用于验收 empty 态 */
  emptyMode: boolean;
  /** 所有调用抛 network 错误 */
  offline: boolean;
  /** 时间偏移（毫秒），用于把结算 / 争议期倒计时"快进" */
  clockOffsetMs: number;
  set: (patch: Partial<Omit<MockRuntimeState, "set" | "reset">>) => void;
  reset: () => void;
};

const defaults = {
  minDelayMs: 120,
  maxDelayMs: 480,
  failureRate: 0,
  emptyMode: false,
  offline: false,
  clockOffsetMs: 0,
};

export const useMockRuntime = create<MockRuntimeState>()(
  persist(
    (set) => ({
      ...defaults,
      set: (patch) => set(patch),
      reset: () => set(defaults),
    }),
    {
      name: "foundation.mock-runtime.v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ set: _set, reset: _reset, ...rest }) => rest,
    },
  ),
);

/** 供非 React 代码（Mock 网关）读取当前设置。 */
function mockRuntime(): Omit<MockRuntimeState, "set" | "reset"> {
  return useMockRuntime.getState();
}

/** Mock 世界的"现在"。所有 Mock 时间判定必须用它而不是 Date.now()。 */
export function mockNow(): number {
  return Date.now() + mockRuntime().clockOffsetMs;
}

export function mockNowIso(): string {
  return new Date(mockNow()).toISOString();
}

let seed = 0x2f6e2b1;
/** 可复现的伪随机（每次冷启动重置），避免测试时依赖 Math.random。 */
export function mockRandom(): number {
  seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

export function resetMockRandom(value = 0x2f6e2b1): void {
  seed = value;
}

/**
 * 包裹一次 Mock 调用：模拟网络延迟、离线、随机失败。
 * 在 Jest 中（NODE_ENV=test）默认零延迟。
 */
export async function simulate<T>(
  work: () => T | Promise<T>,
  options?: { skipDelay?: boolean },
): Promise<T> {
  const runtime = mockRuntime();
  if (runtime.offline) {
    throw new AppError("network", "mock offline", true);
  }
  if (runtime.failureRate > 0 && mockRandom() < runtime.failureRate) {
    throw new AppError("server", "mock failure injected", true, undefined, 503);
  }
  const delay =
    options?.skipDelay || process.env.NODE_ENV === "test"
      ? 0
      : runtime.minDelayMs +
        Math.floor(
          mockRandom() * Math.max(0, runtime.maxDelayMs - runtime.minDelayMs),
        );
  if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
  return work();
}

export function isEmptyMode(): boolean {
  return mockRuntime().emptyMode;
}

/**
 * Mock 状态机用的延时：在 Node（Jest）下 unref，避免测试跑完后进程被挂起的定时器吊住；
 * 在 RN 运行时 unref 不存在，退化为普通 setTimeout。
 */
export function scheduleMock(fn: () => void, ms: number): void {
  const timer = setTimeout(fn, ms) as unknown as { unref?: () => void };
  timer.unref?.();
}
