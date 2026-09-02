import { screen, waitFor } from "@testing-library/react-native";
import { fromDecimal } from "../../../core/money/money";
import {
  createTestGateways,
  renderWithProviders,
  signIn,
} from "../../../test/harness";
import type { InMemoryPredictAccountGateway } from "../../../test/predict-account";
import { MarketListScreen } from "./market-list-screen";

function props() {
  return {
    onOpenEvent: jest.fn(),
    onOrder: jest.fn(),
    onOpenTransfer: jest.fn(),
    onOpenEnable: jest.fn(),
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

  it("shows the predict balance chip once signed in and enabled", async () => {
    const gateways = createTestGateways();
    const session = await signIn(gateways);
    const account = gateways.predictAccount as InMemoryPredictAccountGateway;
    await account.enable(session.address);
    account.balance = {
      ...account.balance,
      available: fromDecimal("1240.5", 6, "USDW"),
      safeBalance: fromDecimal("1560.5", 6, "USDW"),
      lockedInOrders: fromDecimal("320", 6, "USDW"),
    };
    const p = props();
    await renderWithProviders(<MarketListScreen {...p} showPositionsEntry />, {
      gateways,
    });
    await waitFor(() =>
      expect(screen.getByTestId("predict-balance")).toBeTruthy(),
    );
    expect(screen.queryByTestId("predict-topup")).toBeNull();
    expect(screen.queryByTestId("predict-enable")).toBeNull();
    // 已启用：不弹引导
    expect(p.onOpenEnable).not.toHaveBeenCalled();
  });

  it("replaces the chip with a top-up button when the predict balance is empty", async () => {
    const gateways = createTestGateways();
    const session = await signIn(gateways);
    const account = gateways.predictAccount as InMemoryPredictAccountGateway;
    await account.enable(session.address);
    await renderWithProviders(
      <MarketListScreen {...props()} showPositionsEntry />,
      { gateways },
    );
    await waitFor(() =>
      expect(screen.getByTestId("predict-topup")).toBeTruthy(),
    );
    expect(screen.queryByTestId("predict-balance")).toBeNull();
  });

  it("offers the enable button and opens the guide once when the account is not enabled", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    const p = props();
    await renderWithProviders(<MarketListScreen {...p} showPositionsEntry />, {
      gateways,
    });
    await waitFor(() =>
      expect(screen.getByTestId("predict-enable")).toBeTruthy(),
    );
    expect(screen.queryByTestId("predict-balance")).toBeNull();
    await waitFor(() => expect(p.onOpenEnable).toHaveBeenCalledTimes(1));
    // 同一地址再进一次不再打断
    await renderWithProviders(<MarketListScreen {...p} showPositionsEntry />, {
      gateways,
    });
    await waitFor(() =>
      expect(screen.getAllByTestId("predict-enable").length).toBeGreaterThan(0),
    );
    expect(p.onOpenEnable).toHaveBeenCalledTimes(1);
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
    const account = gateways.predictAccount as InMemoryPredictAccountGateway;
    await account.enable(session.address);
    account.balance = {
      ...account.balance,
      available: fromDecimal("5", 6, "USDW"),
      safeBalance: fromDecimal("5", 6, "USDW"),
    };
    await account.withdraw(session.address, fromDecimal("5", 6, "USDW"));
    const after = await account.getBalance();
    expect(after.available).toEqual(fromDecimal("0", 6, "USDW"));
  });
});
