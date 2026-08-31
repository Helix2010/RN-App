import { screen, waitFor } from "@testing-library/react-native";
import { fromDecimal } from "../../../core/money/money";
import {
  createTestGateways,
  renderWithProviders,
  signIn,
} from "../../../test/harness";
import { MarketListScreen } from "./market-list-screen";

function props() {
  return {
    onOpenEvent: jest.fn(),
    onOrder: jest.fn(),
    onOpenTransfer: jest.fn(),
    onOpenPositions: jest.fn(),
    onOpenLeaderboard: jest.fn(),
  };
}

describe("MarketListScreen", () => {
  it("hides the account balance chip for guests", async () => {
    await renderWithProviders(
      <MarketListScreen {...props()} showPositionsEntry />,
    );
    await waitFor(() =>
      expect(screen.getAllByText(/2026/).length).toBeGreaterThan(0),
    );
    expect(screen.queryByTestId("predict-balance")).toBeNull();
    expect(screen.queryByTestId("predict-topup")).toBeNull();
  });

  it("shows the predict balance chip once signed in", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    await renderWithProviders(
      <MarketListScreen {...props()} showPositionsEntry />,
      { gateways },
    );
    await waitFor(() =>
      expect(screen.getByTestId("predict-balance")).toBeTruthy(),
    );
    expect(screen.queryByTestId("predict-topup")).toBeNull();
  });

  it("replaces the chip with a top-up button when the predict balance is empty", async () => {
    const gateways = createTestGateways();
    const session = await signIn(gateways);
    const balance = await gateways.predict.getBalance(session.address);
    await gateways.predict.withdraw(session.address, balance.available);
    await renderWithProviders(
      <MarketListScreen {...props()} showPositionsEntry />,
      { gateways },
    );
    await waitFor(() =>
      expect(screen.getByTestId("predict-topup")).toBeTruthy(),
    );
    expect(screen.queryByTestId("predict-balance")).toBeNull();
  });

  it("only offers the positions shortcut when DEX shares the tab bar", async () => {
    await renderWithProviders(
      <MarketListScreen {...props()} showPositionsEntry={false} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("predict-featured")).toBeTruthy(),
    );
    expect(screen.queryByLabelText("持仓")).toBeNull();
  });

  it("renders the featured banner and market cards from the gateway", async () => {
    await renderWithProviders(
      <MarketListScreen {...props()} showPositionsEntry />,
    );
    expect(await screen.findByTestId("predict-featured")).toBeTruthy();
    expect(await screen.findByTestId("event-ev-btc-120k")).toBeTruthy();
  });

  it("keeps a zero balance from being treated as missing", async () => {
    const gateways = createTestGateways();
    const session = await signIn(gateways);
    const balance = await gateways.predict.getBalance(session.address);
    await gateways.predict.withdraw(session.address, balance.available);
    const after = await gateways.predict.getBalance(session.address);
    expect(after.available).toEqual(fromDecimal("0", 6, "USDC"));
  });
});
