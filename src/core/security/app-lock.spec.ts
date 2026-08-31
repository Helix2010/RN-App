import * as LocalAuthentication from "expo-local-authentication";
import {
  isDeviceEnrolled,
  shouldFallbackToPasscode,
  shouldLockOnResume,
} from "./app-lock";

const base = {
  enabled: true,
  autoLockMinutes: 5,
  backgroundedAt: Date.parse("2026-08-31T12:00:00Z"),
  nowMs: Date.parse("2026-08-31T12:06:00Z"),
  enrolled: true,
};

describe("shouldLockOnResume", () => {
  it("locks after the configured time away", () => {
    expect(shouldLockOnResume(base)).toBe(true);
  });

  it("stays unlocked inside the grace period", () => {
    expect(
      shouldLockOnResume({ ...base, nowMs: base.backgroundedAt + 4 * 60_000 }),
    ).toBe(false);
  });

  it("locks immediately when the delay is zero", () => {
    expect(
      shouldLockOnResume({
        ...base,
        autoLockMinutes: 0,
        nowMs: base.backgroundedAt + 10,
      }),
    ).toBe(true);
  });

  it("never locks when the preference is off", () => {
    expect(shouldLockOnResume({ ...base, enabled: false })).toBe(false);
  });

  it("never locks a device with no biometrics or PIN enrolled", () => {
    // 否则用户会被永久挡在门外
    expect(shouldLockOnResume({ ...base, enrolled: false })).toBe(false);
  });

  it("does not lock before the app has ever been backgrounded", () => {
    expect(shouldLockOnResume({ ...base, backgroundedAt: null })).toBe(false);
  });

  it("ignores a clock that jumped backwards", () => {
    expect(
      shouldLockOnResume({ ...base, nowMs: base.backgroundedAt - 60_000 }),
    ).toBe(false);
  });
});

describe("shouldFallbackToPasscode", () => {
  it("switches to the device passcode after three consecutive failures", () => {
    expect(shouldFallbackToPasscode(2)).toBe(false);
    expect(shouldFallbackToPasscode(3)).toBe(true);
  });
});

describe("isDeviceEnrolled", () => {
  const level = jest.mocked(LocalAuthentication.getEnrolledLevelAsync);

  it("counts a PIN-only device as usable", async () => {
    // Android 的 isEnrolledAsync 只认生物识别，只设了 PIN 的机器会被误判为不可用
    level.mockResolvedValue(LocalAuthentication.SecurityLevel.SECRET);
    await expect(isDeviceEnrolled()).resolves.toBe(true);
  });

  it("reports a device with no screen lock as unusable", async () => {
    level.mockResolvedValue(LocalAuthentication.SecurityLevel.NONE);
    await expect(isDeviceEnrolled()).resolves.toBe(false);
  });

  it("never throws when the native module is unavailable", async () => {
    level.mockRejectedValue(new Error("no native module"));
    await expect(isDeviceEnrolled()).resolves.toBe(false);
  });
});
