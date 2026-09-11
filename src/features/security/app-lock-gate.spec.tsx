import { act, screen, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { usePreferencesStore } from "../../core/preferences/preferences-store";
import { resetAuthFailures, useAppLock } from "../../core/security/app-lock";
import {
  createTestGateways,
  renderWithProviders,
  signIn,
} from "../../test/harness";
import { AppLockGate } from "./app-lock-gate";

const enrolledLevel = jest.mocked(LocalAuthentication.getEnrolledLevelAsync);
const authenticateAsync = jest.mocked(LocalAuthentication.authenticateAsync);

async function renderGate(options: { signedIn?: boolean } = {}) {
  const gateways = createTestGateways();
  if (options.signedIn !== false) await signIn(gateways);
  return renderWithProviders(<AppLockGate />, { gateways });
}

/**
 * 截获 `AppState.addEventListener` 拿到监听器本体再手动调用。
 * RN 在测试环境里的 AppState 是 mock，没有可用的 emit 通道。
 */
function captureAppState(): {
  emit: (next: string) => void;
  restore: () => void;
} {
  const handlers: ((next: string) => void)[] = [];
  const spy = jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_event, handler) => {
      handlers.push(handler as (next: string) => void);
      return { remove: () => {} } as ReturnType<
        typeof AppState.addEventListener
      >;
    });
  return {
    emit: (next) => {
      for (const handler of handlers) handler(next);
    },
    restore: () => spy.mockRestore(),
  };
}

describe("AppLockGate", () => {
  beforeEach(() => {
    resetAuthFailures();
    jest.clearAllMocks();
    useAppLock.setState({
      locked: false,
      backgroundedAt: null,
      enrolled: false,
      lastAttemptFailed: false,
    });
    usePreferencesStore.setState({ appLockEnabled: true, autoLockMinutes: 5 });
    enrolledLevel.mockResolvedValue(
      LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG,
    );
    authenticateAsync.mockResolvedValue({ success: true });
  });

  it("locks on cold start and unlocks once the device verifies", async () => {
    // 把系统验证挂起，才能观察到"锁屏可见"这个中间态
    let approve: (() => void) | undefined;
    authenticateAsync.mockReturnValue(
      new Promise((resolve) => {
        approve = () => resolve({ success: true });
      }),
    );
    const { runtime } = await renderGate();
    await waitFor(() =>
      expect(screen.getByText(runtime.t("security.locked.title"))).toBeTruthy(),
    );
    expect(authenticateAsync).toHaveBeenCalled();
    approve?.();
    await waitFor(() => expect(useAppLock.getState().locked).toBe(false));
    expect(screen.queryByTestId("app-lock-gate")).toBeNull();
  });

  it("keeps the lock up and explains the failure when verification fails", async () => {
    authenticateAsync.mockResolvedValue({
      success: false,
      error: "authentication_failed",
    });
    const { runtime } = await renderGate();
    await waitFor(() =>
      expect(
        screen.getByText(runtime.t("security.unlock.failed")),
      ).toBeTruthy(),
    );
    expect(useAppLock.getState().locked).toBe(true);
  });

  it("stays quiet when the user cancels, without the failure copy", async () => {
    authenticateAsync.mockResolvedValue({
      success: false,
      error: "user_cancel",
    });
    const { runtime } = await renderGate();
    await waitFor(() =>
      expect(screen.getByTestId("app-lock-gate")).toBeTruthy(),
    );
    expect(
      screen.getByText(runtime.t("security.locked.subtitle")),
    ).toBeTruthy();
    expect(screen.queryByText(runtime.t("security.unlock.failed"))).toBeNull();
  });

  it("never locks a device with nothing enrolled", async () => {
    enrolledLevel.mockResolvedValue(LocalAuthentication.SecurityLevel.NONE);
    await renderGate();
    await waitFor(() => expect(useAppLock.getState().enrolled).toBe(false));
    expect(screen.queryByTestId("app-lock-gate")).toBeNull();
    expect(authenticateAsync).not.toHaveBeenCalled();
  });

  it("never locks before the user has connected a wallet", async () => {
    await renderGate({ signedIn: false });
    await waitFor(() => expect(useAppLock.getState().enrolled).toBe(true));
    expect(screen.queryByTestId("app-lock-gate")).toBeNull();
  });

  it("does not lock when the preference is off", async () => {
    usePreferencesStore.setState({ appLockEnabled: false });
    await renderGate();
    await waitFor(() => expect(useAppLock.getState().enrolled).toBe(true));
    expect(screen.queryByTestId("app-lock-gate")).toBeNull();
  });
  // 必须排在最后：这个用例把 AppState.addEventListener 换成替身，替身在位期间
  // 挂载的 gate 不会注册真实监听器，而它触发的 zustand 更新会让 React 19 把
  // 未 flush 完的 act 工作（AggregateError）抛进后面的用例里。
  it("locks the wallet keys the moment the app leaves the foreground", async () => {
    const lockKeys = jest.fn();
    const gateways = createTestGateways({ lockKeys });
    await signIn(gateways);
    usePreferencesStore.setState({ appLockEnabled: false });
    const appState = captureAppState();
    try {
      await renderWithProviders(<AppLockGate />, { gateways });
      // 等挂载时的异步探测落地再动，否则它们会漏到下一个用例里执行
      await waitFor(() => expect(useAppLock.getState().enrolled).toBe(true));
      lockKeys.mockClear();
      await act(async () => {
        appState.emit("background");
      });
      // 解封窗口是"用户在场"的凭据，人一离开就不成立（阶段 0c-2）
      expect(lockKeys).toHaveBeenCalled();
    } finally {
      // 卸载交给 RNTL 的自动清理：在这里手动 cleanup 会让 React 19 把
      // 尚未 flush 的 act 工作抛到下一个用例里（AggregateError）
      appState.restore();
    }
  });
});
