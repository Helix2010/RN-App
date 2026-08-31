import * as LocalAuthentication from "expo-local-authentication";
import { create } from "zustand";

/** 认证结果：`unavailable` = 设备没硬件或没录入，调用方不应因此拦住用户。 */
export type AuthOutcome = "success" | "cancelled" | "failed" | "unavailable";

export type LockDecisionInput = {
  enabled: boolean;
  /** 0 表示离开即锁 */
  autoLockMinutes: number;
  /** 进入后台的时刻；从未进过后台为 null */
  backgroundedAt: number | null;
  nowMs: number;
  /** 设备是否录入了生物识别 / PIN；未录入时永不上锁，避免把用户锁在门外 */
  enrolled: boolean;
};

/** 回前台是否需要解锁：纯函数，便于单测。 */
export function shouldLockOnResume(input: LockDecisionInput): boolean {
  if (!input.enabled || !input.enrolled) return false;
  if (input.backgroundedAt === null) return false;
  const awayMs = input.nowMs - input.backgroundedAt;
  if (awayMs < 0) return false;
  return awayMs >= input.autoLockMinutes * 60_000;
}

/** 连续失败 3 次后强制走设备密码（PIN），不再只试生物识别。 */
export function shouldFallbackToPasscode(consecutiveFailures: number): boolean {
  return consecutiveFailures >= 3;
}

let consecutiveFailures = 0;

/**
 * 本机是否可用于验证身份。
 * 用 getEnrolledLevelAsync 而不是 isEnrolledAsync：后者在 Android 上只认生物识别，
 * 只设了 PIN / 图案的设备会被判成"不可用"，应用锁就永远不生效了。
 */
export async function isDeviceEnrolled(): Promise<boolean> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    return level !== LocalAuthentication.SecurityLevel.NONE;
  } catch {
    return false;
  }
}

/**
 * 弹系统认证。设备没录入时返回 `unavailable`，调用方按"不拦截"处理。
 * 连续失败 3 次后禁用生物识别、只允许设备密码。
 */
export async function authenticate(reason: string): Promise<AuthOutcome> {
  if (!(await isDeviceEnrolled())) return "unavailable";
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      disableDeviceFallback: false,
      requireConfirmation: false,
      biometricsSecurityLevel: shouldFallbackToPasscode(consecutiveFailures)
        ? "strong"
        : "weak",
    });
    if (result.success) {
      consecutiveFailures = 0;
      return "success";
    }
    if (result.error === "user_cancel" || result.error === "app_cancel") {
      return "cancelled";
    }
    consecutiveFailures += 1;
    return "failed";
  } catch {
    consecutiveFailures += 1;
    return "failed";
  }
}

export function resetAuthFailures(): void {
  consecutiveFailures = 0;
}

type AppLockState = {
  /** 应用锁当前是否挡在界面前 */
  locked: boolean;
  backgroundedAt: number | null;
  enrolled: boolean;
  /** 上一次解锁验证是否失败（用于在锁屏上换文案） */
  lastAttemptFailed: boolean;
  lock: () => void;
  unlock: () => void;
  noteAttemptFailed: () => void;
  setEnrolled: (enrolled: boolean) => void;
  noteBackgrounded: (nowMs?: number) => void;
  clearBackgrounded: () => void;
};

export const useAppLock = create<AppLockState>((set) => ({
  locked: false,
  backgroundedAt: null,
  enrolled: false,
  lastAttemptFailed: false,
  lock: () => set({ locked: true, lastAttemptFailed: false }),
  unlock: () =>
    set({ locked: false, backgroundedAt: null, lastAttemptFailed: false }),
  noteAttemptFailed: () => set({ lastAttemptFailed: true }),
  setEnrolled: (enrolled) => set({ enrolled }),
  noteBackgrounded: (nowMs = Date.now()) => set({ backgroundedAt: nowMs }),
  clearBackgrounded: () => set({ backgroundedAt: null }),
}));
