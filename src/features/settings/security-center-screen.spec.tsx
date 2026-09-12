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
      txVerification: "smart",
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
    usePreferencesStore.setState({
      appLockEnabled: false,
      txVerification: "off",
    });
    const { runtime } = await renderSecurity();
    await waitFor(() =>
      expect(screen.getByText(runtime.t("security.level.low"))).toBeTruthy(),
    );
  });

  it("states that signing out and uninstalling do not delete the keys on this device", async () => {
    // 卸载不等于删除（iOS 钥匙串会留）、退出登录也不删金库：用户据此判断
    // "我还能不能拿回这个钱包"，这句必须一直在（安全评审 §6 / §13 0c-5）
    const { runtime } = await renderSecurity();
    await waitFor(() =>
      expect(
        screen.getByText(runtime.t("security.wallets.footnote")),
      ).toBeTruthy(),
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

  // 开通流程里口令可以跳过，跳过之后这里是唯一的入口（安全评审 N6）
  describe("钱包口令", () => {
    async function renderWithPassphrase(enabled: boolean) {
      const gateways = createTestGateways();
      // 口令只对本机保管的钱包有意义，所以要先有一个内置账户
      await gateways.wallet.createWallet();
      await signIn(gateways);
      gateways.wallet.isPassphraseProtected = jest.fn(async () => enabled);
      const navigation = fakeNavigation();
      return {
        navigation,
        ...(await renderWithProviders(
          <SecurityCenterScreen
            navigation={navigation}
            route={fakeNavigation()}
          />,
          { gateways },
        )),
      };
    }

    it("没设过就标出来，点进去能设", async () => {
      const { navigation, runtime } = await renderWithPassphrase(false);

      const row = await screen.findByTestId("sec-passphrase");
      expect(
        await screen.findByText(runtime.t("security.passphrase.off")),
      ).toBeTruthy();

      void fireEvent.press(row);

      expect(navigation.navigate).toHaveBeenCalledWith("WalletPassphrase");
    });

    // 换口令要把信封整个换掉，做错一步就是钱包打不开；那是一条独立的流程
    it("已经开了就只显示状态，不给再点一次的入口", async () => {
      const { navigation, runtime } = await renderWithPassphrase(true);

      expect(
        await screen.findByText(runtime.t("security.passphrase.on")),
      ).toBeTruthy();

      void fireEvent.press(screen.getByTestId("sec-passphrase"));

      expect(navigation.navigate).not.toHaveBeenCalledWith("WalletPassphrase");
    });
  });

  // 评审 0c-2：5 分钟太长（拿到一台刚解锁的设备就有五分钟随便签名），
  // 0 又会让开通预测连弹三次。默认 60 秒，四档让用户自己选。
  it("签名免验证时长默认 60 秒，可以在四档之间轮换", async () => {
    const { runtime } = await renderSecurity();

    expect(usePreferencesStore.getState().keyUnlockSeconds).toBe(60);
    expect(
      await screen.findByText(runtime.t("security.keyUnlock")),
    ).toBeTruthy();

    const row = screen.getByTestId("sec-key-unlock");
    void fireEvent.press(row);
    await waitFor(() =>
      expect(usePreferencesStore.getState().keyUnlockSeconds).toBe(300),
    );
    void fireEvent.press(screen.getByTestId("sec-key-unlock"));
    await waitFor(() =>
      expect(usePreferencesStore.getState().keyUnlockSeconds).toBe(900),
    );
    // 转回"每次都验证"，最严的那一档必须够得着
    void fireEvent.press(screen.getByTestId("sec-key-unlock"));
    await waitFor(() =>
      expect(usePreferencesStore.getState().keyUnlockSeconds).toBe(0),
    );
    expect(
      screen.getByText(runtime.t("security.keyUnlock.everyTime")),
    ).toBeTruthy();
  });
});
