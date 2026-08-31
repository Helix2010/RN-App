import { screen, waitFor } from "@testing-library/react-native";
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
});
