import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { usePreferencesStore } from "../../core/preferences/preferences-store";
import { createFallbackConfig } from "../../core/config/fallback-config";
import {
  createTestGateways,
  fakeNavigation,
  renderWithProviders,
  signIn,
} from "../../test/harness";
import { SettingsScreen } from "./settings-screen";

async function renderSettings(
  options: Parameters<typeof renderWithProviders>[1] = {},
) {
  const gateways = createTestGateways(options.gateways);
  await signIn(gateways);
  return renderWithProviders(
    <SettingsScreen navigation={fakeNavigation()} route={fakeNavigation()} />,
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
