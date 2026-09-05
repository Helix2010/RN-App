import * as LocalAuthentication from "expo-local-authentication";
import { create } from "zustand";

/** 认证结果：`unavailable` = 设备没硬件或没录入，调用方不应因此拦住用户。 */
export type AuthOutcome = "success" | "cancelled" | "failed" | "unavailable";

/** 本机主要的验证方式：决定锁屏上画指纹、面容还是密码图标。 */
export type BiometricKind = "fingerprint" | "face" | "iris" | "passcode";

/**
 * "最近验证过"的有效期：应用锁解锁、交易前验证、钱包签名验证任一通过后，
 * 这段时间内的敏感操作在「智能」策略下不再重复弹系统验证（签名本身仍由金库门控）。
 * 与金库的解锁窗口相同长度，两者语义一致："5 分钟内算同一次验证"。
 */
export const RECENT_VERIFICATION_WINDOW_MS = 5 * 60_000;

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
/** 最近一次系统验证通过的时刻（进程内）；上锁时清零 */
let lastVerifiedAt: number | null = null;

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
 * 本机的验证方式：录入了生物识别按硬件类型分（指纹 / 面容 / 虹膜），
 * 只有锁屏密码时是 `passcode`。只用于锁屏图标与提示文案，不参与安全判定。
 */
export async function biometricKind(): Promise<BiometricKind> {
  try {
    const level = await LocalAuthentication.getEnrolledLevelAsync();
    if (
      level !== LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG &&
      level !== LocalAuthentication.SecurityLevel.BIOMETRIC_WEAK
    )
      return "passcode";
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT))
      return "fingerprint";
    if (
      types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
    )
      return "face";
    if (types.includes(LocalAuthentication.AuthenticationType.IRIS))
      return "iris";
    return "passcode";
  } catch {
    return "passcode";
  }
}

/**
 * 弹系统认证。设备没录入时返回 `unavailable`，调用方按"不拦截"处理。
 * 连续失败 3 次后禁用生物识别、只允许设备密码。通过后记下时刻，供「智能」策略判断。
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
      noteVerified();
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

/** 记下"刚验证过"。`authenticate` 成功时自动调用；测试与替身端口也可直接调。 */
export function noteVerified(nowMs = Date.now()): void {
  lastVerifiedAt = nowMs;
}

/** 忘掉最近的验证：应用上锁时调用，上一次的验证不能替锁屏后的操作背书。 */
export function forgetVerification(): void {
  lastVerifiedAt = null;
}

/** 最近 `windowMs` 内是否通过过系统验证。 */
export function verifiedWithin(windowMs: number, nowMs = Date.now()): boolean {
  return lastVerifiedAt !== null && nowMs - lastVerifiedAt < windowMs;
}

type AppLockState = {
  /** 应用锁当前是否挡在界面前 */
  locked: boolean;
  backgroundedAt: number | null;
  enrolled: boolean;
  /** 本机验证方式（锁屏图标用） */
  kind: BiometricKind;
  /** 上一次解锁验证是否失败（用于在锁屏上换文案） */
  lastAttemptFailed: boolean;
  lock: () => void;
  unlock: () => void;
  noteAttemptFailed: () => void;
  setEnrolled: (enrolled: boolean) => void;
  setKind: (kind: BiometricKind) => void;
  noteBackgrounded: (nowMs?: number) => void;
  clearBackgrounded: () => void;
};

export const useAppLock = create<AppLockState>((set) => ({
  locked: false,
  backgroundedAt: null,
  enrolled: false,
  kind: "passcode",
  lastAttemptFailed: false,
  lock: () => {
    forgetVerification();
    set({ locked: true, lastAttemptFailed: false });
  },
  unlock: () =>
    set({ locked: false, backgroundedAt: null, lastAttemptFailed: false }),
  noteAttemptFailed: () => set({ lastAttemptFailed: true }),
  setEnrolled: (enrolled) => set({ enrolled }),
  setKind: (kind) => set({ kind }),
  noteBackgrounded: (nowMs = Date.now()) => set({ backgroundedAt: nowMs }),
  clearBackgrounded: () => set({ backgroundedAt: null }),
}));
