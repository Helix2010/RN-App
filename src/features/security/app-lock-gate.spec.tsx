import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
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
    // 失败后动画停下：呼吸和光环都不再提示"可以点"，交给红色 + 轻晃
    expect(screen.queryByTestId("app-lock-halo")).toBeNull();
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
  // 底部那颗"使用指纹解锁"按钮去掉了：图标本身就是那个按钮
  it("retries from the icon after a cancel, with no separate unlock button", async () => {
    authenticateAsync.mockResolvedValue({
      success: false,
      error: "user_cancel",
    });
    const { runtime } = await renderGate();
    await waitFor(() =>
      expect(screen.getByTestId("app-lock-unlock")).toBeTruthy(),
    );
    expect(screen.queryByTestId("app-lock-unlock-button")).toBeNull();
    expect(screen.getByTestId("app-lock-halo")).toBeTruthy();
    // 图标没有文字标签，下面那句说明它可以点
    expect(
      screen.getByText(runtime.t("security.unlock.with.fingerprint")),
    ).toBeTruthy();

    const before = authenticateAsync.mock.calls.length;
    authenticateAsync.mockResolvedValue({ success: true });
    await fireEvent.press(screen.getByTestId("app-lock-unlock"));

    await waitFor(() => expect(useAppLock.getState().locked).toBe(false));
    expect(authenticateAsync.mock.calls.length).toBeGreaterThan(before);
  });

  // "点了指纹没弹出验证"：Android 上一个弹窗还在收起时再拉起，系统会秒回一个取消
  it("retries when the system swallows the prompt and returns an instant cancel", async () => {
    authenticateAsync
      .mockResolvedValueOnce({ success: false, error: "user_cancel" })
      .mockResolvedValueOnce({ success: true });

    await renderGate();

    await waitFor(() => expect(useAppLock.getState().locked).toBe(false), {
      timeout: 3000,
    });
    expect(authenticateAsync).toHaveBeenCalledTimes(2);
  });

  // 人点的取消（慢回来的）不重试，页面停在锁屏等用户自己动
  it("leaves a real cancel alone", async () => {
    authenticateAsync.mockImplementation(
      async () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ success: false, error: "user_cancel" }),
            700,
          ),
        ),
    );

    await renderGate();

    await waitFor(() =>
      expect(screen.getByTestId("app-lock-gate")).toBeTruthy(),
    );
    await waitFor(() => expect(authenticateAsync).toHaveBeenCalledTimes(1));
    expect(useAppLock.getState().locked).toBe(true);
  });

  // 验证失败后重入标记必须放开，否则这一页之后再也弹不出来
  it("can prompt again after a failed attempt", async () => {
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

    const before = authenticateAsync.mock.calls.length;
    authenticateAsync.mockResolvedValue({ success: true });
    await fireEvent.press(screen.getByTestId("app-lock-unlock"));

    await waitFor(() => expect(useAppLock.getState().locked).toBe(false), {
      timeout: 3000,
    });
    expect(authenticateAsync.mock.calls.length).toBeGreaterThan(before);
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
  it("prompts again when the app comes back while still locked", async () => {
    // 先让它锁住并停在"用户取消"的状态
    authenticateAsync.mockImplementation(
      async () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ success: false, error: "user_cancel" }),
            700,
          ),
        ),
    );
    const gateways = createTestGateways();
    await signIn(gateways);
    const appState = captureAppState();
    try {
      await renderWithProviders(<AppLockGate />, { gateways });
      await waitFor(() => expect(useAppLock.getState().locked).toBe(true));
      await waitFor(() => expect(authenticateAsync).toHaveBeenCalledTimes(1));

      authenticateAsync.mockResolvedValue({ success: true });
      await act(async () => {
        appState.emit("active");
      });

      await waitFor(() => expect(useAppLock.getState().locked).toBe(false), {
        timeout: 3000,
      });
    } finally {
      appState.restore();
    }
  });
  // 用户路径：冷启动弹窗 → 取消 → 点图标再弹 → 取消 → 手机息屏 → 再点就不弹了。
  // 息屏时系统收走了弹窗，而那个 Promise 不再返回，防重入标记会永远卡住
  it("releases the prompt guard when the app is sent to the background", async () => {
    // 永不 resolve：模拟被系统收走的那次弹窗
    authenticateAsync.mockImplementation(
      () => new Promise(() => undefined) as Promise<never>,
    );
    const gateways = createTestGateways();
    await signIn(gateways);
    const appState = captureAppState();
    try {
      await renderWithProviders(<AppLockGate />, { gateways });
      await waitFor(() => expect(authenticateAsync).toHaveBeenCalledTimes(1));

      await act(async () => {
        appState.emit("background");
      });
      authenticateAsync.mockResolvedValue({ success: true });
      await fireEvent.press(screen.getByTestId("app-lock-unlock"));

      await waitFor(() => expect(useAppLock.getState().locked).toBe(false), {
        timeout: 3000,
      });
    } finally {
      appState.restore();
    }
  });
});
