import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { usePreferencesStore } from "../../core/preferences/preferences-store";
import { createFallbackConfig } from "../../core/config/fallback-config";
import {
  createTestGateways,
  fakeNavigation,
  renderWithProviders,
  signIn,
} from "../../test/harness";
import { SettingsScreen } from "./settings-screen";
import { AppearanceSettingsScreen } from "./appearance-settings-screen";

async function renderSettings(
  options: Parameters<typeof renderWithProviders>[1] = {},
  navigation = fakeNavigation(),
) {
  const gateways = createTestGateways(options.gateways);
  await signIn(gateways);
  return renderWithProviders(
    <SettingsScreen navigation={navigation} route={fakeNavigation()} />,
    { ...options, gateways },
  );
}

describe("SettingsScreen", () => {
  beforeEach(() => {
    usePreferencesStore.setState({
      theme: "system",
      locale: "system",
      colorScheme: "green-up",
      appLockEnabled: true,
      txVerification: "smart",
    });
  });

  describe("crash reports", () => {
    beforeEach(async () => {
      await AsyncStorage.removeItem("foundation.diagnostics.pending-crash.v1");
      usePreferencesStore.setState({ crashAutoReport: null });
    });

    it("offers the automatic crash report switch only when the tenant turned it on", async () => {
      const off = createFallbackConfig("zh-CN");
      off.features.crashAutoReport = false;
      await renderSettings({ config: () => off });
      await screen.findByTestId("settings-check-update");
      expect(screen.queryByTestId("settings-auto-crash-report")).toBeNull();
    });

    it("follows the tenant until the user switches it off", async () => {
      const on = createFallbackConfig("zh-CN");
      on.features.crashAutoReport = true;
      await renderSettings({ config: () => on });
      const toggle = await screen.findByTestId("settings-auto-crash-report");
      expect(toggle.props.accessibilityState).toMatchObject({ checked: true });
      await fireEvent.press(toggle);
      expect(usePreferencesStore.getState().crashAutoReport).toBe(false);
    });

    it("asks to report the last crash when one was left behind", async () => {
      await AsyncStorage.setItem(
        "foundation.diagnostics.pending-crash.v1",
        JSON.stringify({
          version: 1,
          at: 1,
          source: "global",
          errorName: "TypeError",
          frame: "renderRow",
          app: {
            version: "1.2.3",
            buildNumber: "45",
            runtimeVersion: "1.2.0",
            otaChannel: "production",
            distributionChannel: "direct",
            launchSource: "embedded",
          },
          tail: [],
        }),
      );
      const navigation = fakeNavigation();
      await renderSettings({}, navigation);
      await fireEvent.press(
        await screen.findByTestId("settings-pending-crash"),
      );
      expect(navigation.navigate).toHaveBeenCalledWith("ReportProblem", {
        source: "crash",
      });
    });

    it("says nothing when there is no crash to report", async () => {
      await renderSettings();
      await screen.findByTestId("settings-check-update");
      expect(screen.queryByTestId("settings-pending-crash")).toBeNull();
    });
  });

  it("shows predict-only trading preferences when DEX is off", async () => {
    await renderSettings({ modules: { dex: false } });
    expect(await screen.findByTestId("settings-predict-confirm")).toBeTruthy();
    expect(screen.queryByTestId("settings-dex-slippage")).toBeNull();
  });

  it("shows dex-only trading preferences when Predict is off", async () => {
    await renderSettings({ modules: { predict: false } });
    expect(await screen.findByTestId("settings-dex-slippage")).toBeTruthy();
    expect(screen.queryByTestId("settings-predict-order-type")).toBeNull();
  });

  it("reflects the current device preferences in the row values", async () => {
    usePreferencesStore.setState({ theme: "dark", locale: "en-US" });
    const { runtime } = await renderSettings();
    expect(screen.getByText(runtime.t("theme.dark"))).toBeTruthy();
    expect(screen.getByText("English")).toBeTruthy();
  });

  it("marks the update row with a dot only when an update is available", async () => {
    const { runtime } = await renderSettings({
      config: (config) => ({
        ...config,
        update: {
          ...config.update,
          decision: "optional",
          latestVersion: "9.9.9",
        },
      }),
    });
    expect(
      screen.getByText(
        runtime.t("settings.newVersion").replace("{version}", "9.9.9"),
      ),
    ).toBeTruthy();
  });

  it("says up to date when there is no update", async () => {
    const { runtime } = await renderSettings({
      config: (config) => ({
        ...config,
        update: { ...config.update, decision: "none" },
      }),
    });
    expect(screen.getByText(runtime.t("settings.upToDate"))).toBeTruthy();
  });

  it("uses the delivered palette in the appearance previews", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    await renderWithProviders(
      <AppearanceSettingsScreen
        navigation={fakeNavigation()}
        route={fakeNavigation()}
      />,
      {
        gateways,
        config: (config) => ({
          ...config,
          theme: {
            ...config.theme,
            light: {
              ...config.theme.light,
              background: "#123456",
              surface: "#234567",
              surfaceVariant: "#345678",
              primary: "#456789",
            },
            dark: {
              ...config.theme.dark,
              background: "#654321",
              surface: "#765432",
              surfaceVariant: "#876543",
              primary: "#987654",
            },
          },
        }),
      },
    );
    expect(screen.getByTestId("theme-system-light-preview")).toHaveStyle({
      backgroundColor: "#123456",
    });
    expect(screen.getByTestId("theme-system-dark-preview")).toHaveStyle({
      backgroundColor: "#654321",
    });
  });

  it("checks updates in place without navigating to another screen", async () => {
    const navigation = fakeNavigation();
    const checkForUpdates = jest.fn(async () => ({
      kind: "none" as const,
      snapshot: {
        config: createFallbackConfig("zh-CN"),
        source: "remote" as const,
        stale: false,
      },
    }));
    const gateways = createTestGateways();
    await signIn(gateways);
    await renderWithProviders(
      <SettingsScreen navigation={navigation} route={fakeNavigation()} />,
      { gateways, runtime: { checkForUpdates } },
    );

    void fireEvent.press(screen.getByTestId("settings-check-update"));
    await waitFor(() => expect(checkForUpdates).toHaveBeenCalledTimes(1));
    expect(navigation.navigate).not.toHaveBeenCalledWith("UpdateCenter");
  });
});
