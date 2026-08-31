import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as LocalAuthentication from "expo-local-authentication";
import { usePreferencesStore } from "../../core/preferences/preferences-store";
import { resetAuthFailures, useAppLock } from "../../core/security/app-lock";
import {
  createTestGateways,
  fakeNavigation,
  renderWithProviders,
  signIn,
} from "../../test/harness";
import { SecurityCenterScreen } from "./security-center-screen";

async function renderSecurity(
  options: Parameters<typeof renderWithProviders>[1] = {},
) {
  const gateways = createTestGateways(options.gateways);
  await signIn(gateways);
  return renderWithProviders(
    <SecurityCenterScreen
      navigation={fakeNavigation()}
      route={fakeNavigation()}
    />,
    { ...options, gateways },
  );
}

describe("SecurityCenterScreen", () => {
  beforeEach(() => {
    resetAuthFailures();
    jest.clearAllMocks();
    jest
      .mocked(LocalAuthentication.getEnrolledLevelAsync)
      .mockResolvedValue(LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG);
    jest
      .mocked(LocalAuthentication.authenticateAsync)
      .mockResolvedValue({ success: true });
    usePreferencesStore.setState({
      appLockEnabled: true,
      txConfirm: true,
      sendWhitelistOnly: false,
    });
    // 设备已录入凭据，应用锁才算真正生效
    useAppLock.setState({ enrolled: true, locked: false });
  });

  it("rates an external wallet with both protections on as high", async () => {
    const { runtime } = await renderSecurity();
    await waitFor(() =>
      expect(screen.getByText(runtime.t("security.level.high"))).toBeTruthy(),
    );
    expect(
      screen.queryByText(runtime.t("security.suggest.appLock")),
    ).toBeNull();
  });

  it("drops to medium and suggests the app lock when it is off", async () => {
    usePreferencesStore.setState({ appLockEnabled: false });
    const { runtime } = await renderSecurity();
    await waitFor(() =>
      expect(screen.getByText(runtime.t("security.level.medium"))).toBeTruthy(),
    );
    expect(
      screen.getByText(runtime.t("security.suggest.appLock")),
    ).toBeTruthy();
  });

  it("drops to low when both protections are off", async () => {
    usePreferencesStore.setState({ appLockEnabled: false, txConfirm: false });
    const { runtime } = await renderSecurity();
    await waitFor(() =>
      expect(screen.getByText(runtime.t("security.level.low"))).toBeTruthy(),
    );
  });

  it("only offers token approvals when DEX is enabled", async () => {
    await renderSecurity({ modules: { dex: false } });
    await waitFor(() =>
      expect(screen.getByTestId("sec-app-lock")).toBeTruthy(),
    );
    expect(screen.queryByTestId("sec-approvals")).toBeNull();
  });
  it("warns that the app lock has no effect without device credentials", async () => {
    useAppLock.setState({ enrolled: false });
    const { runtime } = await renderSecurity();
    // 顶部建议与开关副标题各一处
    await waitFor(() =>
      expect(
        screen.getAllByText(runtime.t("security.appLock.unavailable")),
      ).toHaveLength(2),
    );
    // 未生效的锁不计入安全等级，且不能提示"建议开启应用锁"（它已经开着）
    expect(screen.getByText(runtime.t("security.level.medium"))).toBeTruthy();
    expect(
      screen.queryByText(runtime.t("security.suggest.appLock")),
    ).toBeNull();
  });

  it("requires device verification before the app lock can be turned off", async () => {
    jest
      .mocked(LocalAuthentication.authenticateAsync)
      .mockResolvedValue({ success: false, error: "user_cancel" });
    await renderSecurity();
    await waitFor(() =>
      expect(screen.getByTestId("sec-app-lock")).toBeTruthy(),
    );
    await fireEvent(screen.getByTestId("sec-app-lock"), "valueChange", false);
    await waitFor(() =>
      expect(LocalAuthentication.authenticateAsync).toHaveBeenCalled(),
    );
    expect(usePreferencesStore.getState().appLockEnabled).toBe(true);
  });

  it("turns the app lock off once verification passes", async () => {
    useAppLock.setState({ locked: true });
    await renderSecurity();
    await waitFor(() =>
      expect(screen.getByTestId("sec-app-lock")).toBeTruthy(),
    );
    await fireEvent(screen.getByTestId("sec-app-lock"), "valueChange", false);
    await waitFor(() =>
      expect(usePreferencesStore.getState().appLockEnabled).toBe(false),
    );
    expect(useAppLock.getState().locked).toBe(false);
  });
});
