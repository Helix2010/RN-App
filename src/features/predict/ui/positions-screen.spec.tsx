import { screen, waitFor } from "@testing-library/react-native";
import {
  createTestGateways,
  renderWithProviders,
  signIn,
} from "../../../test/harness";
import { PositionsScreen } from "./positions-screen";

function props() {
  return {
    onOpenEvent: jest.fn(),
    onOpenSettlement: jest.fn(),
    onOpenTransfer: jest.fn(),
  };
}

describe("PositionsScreen", () => {
  it("asks guests to connect instead of rendering an empty portfolio", async () => {
    const { runtime } = await renderWithProviders(
      <PositionsScreen {...props()} />,
    );
    await waitFor(() =>
      expect(
        screen.getByText(runtime.t("predict.positions.empty")),
      ).toBeTruthy(),
    );
    expect(screen.queryByTestId("positions-claim")).toBeNull();
  });

  it("surfaces the claimable payout for a settled winning position", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    await renderWithProviders(<PositionsScreen {...props()} />, { gateways });
    expect(await screen.findByTestId("positions-claim")).toBeTruthy();
  });

  it("removes the claim call to action once the payout is redeemed", async () => {
    const gateways = createTestGateways();
    const session = await signIn(gateways);
    const positions = await gateways.predict.listPositions(session.address);
    const claimable = positions.find((item) => item.redeemable);
    expect(claimable).toBeDefined();
    await gateways.predict.redeem(session.address, [claimable?.id ?? ""]);
    const { runtime } = await renderWithProviders(
      <PositionsScreen {...props()} />,
      { gateways },
    );
    // 等汇总卡加载完成，再断言"领取"入口消失
    await screen.findByText(runtime.t("predict.positions.value"));
    await waitFor(() =>
      expect(screen.queryByTestId("positions-claim")).toBeNull(),
    );
  });

  it("shows a back button only when pushed on top of another tab", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    const onBack = jest.fn();
    const { runtime } = await renderWithProviders(
      <PositionsScreen {...props()} onBack={onBack} />,
      { gateways },
    );
    expect(await screen.findByLabelText(runtime.t("action.back"))).toBeTruthy();
  });
});
