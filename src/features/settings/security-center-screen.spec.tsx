import { screen, waitFor } from "@testing-library/react-native";
import { usePreferencesStore } from "../../core/preferences/preferences-store";
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
    usePreferencesStore.setState({
      appLockEnabled: true,
      txConfirm: true,
      sendWhitelistOnly: false,
    });
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
});
