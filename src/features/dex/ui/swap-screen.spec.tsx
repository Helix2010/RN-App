import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import {
  createTestGateways,
  renderWithProviders,
  signIn,
} from "../../../test/harness";
import { SwapScreen } from "./swap-screen";

function props() {
  return {
    onOpenHistory: jest.fn(),
    onOpenTransfer: jest.fn(),
    onBack: jest.fn(),
  };
}

describe("SwapScreen", () => {
  it("asks guests to connect before quoting", async () => {
    const { runtime } = await renderWithProviders(<SwapScreen {...props()} />);
    expect(
      await screen.findByText(runtime.t("home.connectWallet")),
    ).toBeTruthy();
  });

  it("quotes on input and shows the expanded fee breakdown", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    const { runtime } = await renderWithProviders(<SwapScreen {...props()} />, {
      gateways,
    });
    await fireEvent.changeText(await screen.findByTestId("swap-amount"), "0.5");
    // 注意：bottom-sheet 的测试 mock 会把 sheet 内容一并渲染，所以这里用 getAllByText
    await waitFor(() =>
      expect(
        screen.getAllByText(runtime.t("swap.rate")).length,
      ).toBeGreaterThan(0),
    );
    // 报价明细必须全部展开，不藏在折叠里
    for (const key of [
      "swap.priceImpact",
      "swap.minReceived",
      "swap.slippage",
      "swap.networkFee",
      "swap.serviceFee",
      "swap.route",
    ]) {
      expect(screen.getAllByText(runtime.t(key)).length).toBeGreaterThan(0);
    }
    expect(screen.getByTestId("swap-submit")).toBeTruthy();
  });

  it("offers a transfer instead of a swap when the balance is short", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    const { runtime } = await renderWithProviders(<SwapScreen {...props()} />, {
      gateways,
    });
    await fireEvent.changeText(
      await screen.findByTestId("swap-amount"),
      "999999",
    );
    await waitFor(() =>
      expect(screen.getByText(runtime.t("swap.insufficient"))).toBeTruthy(),
    );
  });
});
