import { screen, waitFor } from "@testing-library/react-native";
import {
  createTestGateways,
  renderWithProviders,
  signIn,
} from "../../../test/harness";
import { AssetsScreen } from "./assets-screen";

function renderAssets(options: Parameters<typeof renderWithProviders>[1] = {}) {
  return renderWithProviders(
    <AssetsScreen
      onOpenAccount={jest.fn()}
      onOpenSend={jest.fn()}
      onOpenSwap={jest.fn()}
    />,
    options,
  );
}

describe("AssetsScreen", () => {
  it("gates guests behind the login prompt instead of showing an empty portfolio", async () => {
    await renderAssets();
    await waitFor(() =>
      expect(screen.getByTestId("assets-connect")).toBeTruthy(),
    );
    expect(screen.queryByTestId("assets-wallet")).toBeNull();
  });

  it("shows the predict account card and transfer action when Predict is on", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    await renderAssets({ gateways });
    await waitFor(() =>
      expect(screen.getByTestId("assets-predict")).toBeTruthy(),
    );
    expect(screen.getByTestId("assets-transfer")).toBeTruthy();
    expect(screen.queryByTestId("assets-swap")).toBeNull();
  });

  it("hides the predict account and swaps the third action when Predict is off", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    await renderAssets({ gateways, modules: { predict: false } });
    await waitFor(() =>
      expect(screen.getByTestId("assets-wallet")).toBeTruthy(),
    );
    expect(screen.queryByTestId("assets-predict")).toBeNull();
    expect(screen.getByTestId("assets-swap")).toBeTruthy();
    expect(screen.queryByTestId("assets-transfer")).toBeNull();
  });

  it("formats amounts as currency rather than raw minor units", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    await renderAssets({ gateways });
    // 千分位 + 两位小数；不断言货币符号（Node 的完整 ICU 与设备上的 Hermes 前缀不同）
    const amounts = await screen.findAllByText(/\d{1,3}(,\d{3})+\.\d{2}/);
    expect(amounts.length).toBeGreaterThan(0);
    expect(screen.queryByText(/^\d{7,}$/)).toBeNull();
  });
});
