import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { fromDecimal } from "../../../core/money/money";
import {
  createTestGateways,
  renderWithProviders,
  signIn,
} from "../../../test/harness";
import type { InMemoryPredictAccountGateway } from "../../../test/predict-account";
import { useMockRuntime } from "../../../core/mock/mock-runtime";
import { useFavoritesStore } from "../model/favorites-store";
import { MarketListScreen } from "./market-list-screen";

function props() {
  return {
    onOpenEvent: jest.fn(),
    onOrder: jest.fn(),
    onOpenTransfer: jest.fn(),
    onOpenEnable: jest.fn(),
    onOpenPositions: jest.fn(),
    onOpenLeaderboard: jest.fn(),
    onOpenSeries: jest.fn(),
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
      expect(screen.getByTestId("predict-hero-ev-worldcup")).toBeTruthy(),
    );
    expect(screen.queryByLabelText("持仓")).toBeNull();
  });

  it("renders the featured banner and market cards from the gateway", async () => {
    await renderWithProviders(
      <MarketListScreen {...props()} showPositionsEntry />,
    );
    expect(await screen.findByTestId("predict-hero-ev-worldcup")).toBeTruthy();
    expect(await screen.findByTestId("event-ev-btc-120k")).toBeTruthy();
    // 只有平台给了图标的事件才渲染图标，其它卡不占位
    expect(screen.getByTestId("event-icon-ev-btc-120k")).toBeTruthy();
    expect(screen.queryByTestId("event-icon-ev-fomc-sep")).toBeNull();
  });

  it("filters the loaded list locally by search text", async () => {
    await renderWithProviders(
      <MarketListScreen {...props()} showPositionsEntry />,
    );
    expect(await screen.findByTestId("event-ev-btc-120k")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("predict-search"), "FOMC");
    await waitFor(() =>
      expect(screen.queryByTestId("event-ev-btc-120k")).toBeNull(),
    );
    expect(screen.getByTestId("event-ev-fomc-sep")).toBeTruthy();
    await fireEvent.changeText(
      screen.getByTestId("predict-search"),
      "zzz-nothing",
    );
    expect(await screen.findByText("没有匹配的市场")).toBeTruthy();
  });

  it("switches to closed markets and hides the discovery sections there", async () => {
    await renderWithProviders(
      <MarketListScreen {...props()} showPositionsEntry />,
    );
    expect(await screen.findByTestId("predict-hero-ev-worldcup")).toBeTruthy();
    expect(await screen.findByTestId("predict-series")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("predict-status-closed"));
    // "热门"标签下没有已结束的市场：空态，且精选 / 周期市场区块收起
    expect(await screen.findByText("暂无数据")).toBeTruthy();
    expect(screen.queryByTestId("event-ev-btc-120k")).toBeNull();
    expect(screen.queryByTestId("predict-hero-ev-worldcup")).toBeNull();
    expect(screen.queryByTestId("predict-series")).toBeNull();
    await fireEvent.press(screen.getByText("体育"));
    expect(await screen.findByTestId("event-ev-mun-liv")).toBeTruthy();
    expect(screen.queryByTestId("event-ev-worldcup")).toBeNull();
  });

  it("shows favorites only after the star was toggled on a card", async () => {
    useFavoritesStore.setState({ ids: [] });
    const p = props();
    await renderWithProviders(<MarketListScreen {...p} showPositionsEntry />);
    expect(await screen.findByTestId("event-ev-btc-120k")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("predict-favorites"));
    expect(await screen.findByTestId("predict-favorites-empty")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("predict-status-trading"));
    expect(await screen.findByTestId("event-ev-btc-120k")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("favorite-ev-btc-120k"));
    expect(useFavoritesStore.getState().ids).toEqual(["ev-btc-120k"]);
    await fireEvent.press(screen.getByTestId("predict-favorites"));
    expect(await screen.findByTestId("event-ev-btc-120k")).toBeTruthy();
    expect(screen.queryByTestId("event-ev-fomc-sep")).toBeNull();
    expect(screen.queryByTestId("predict-favorites-empty")).toBeNull();
  });

  it("keeps the loaded favorites when one favorite no longer exists on the platform", async () => {
    useFavoritesStore.setState({ ids: ["ev-btc-120k", "ev-gone"] });
    await renderWithProviders(
      <MarketListScreen {...props()} showPositionsEntry />,
    );
    await fireEvent.press(await screen.findByTestId("predict-favorites"));
    expect(await screen.findByTestId("event-ev-btc-120k")).toBeTruthy();
    expect(await screen.findByTestId("predict-favorites-error")).toBeTruthy();
    expect(screen.getByText("1 个收藏的市场加载失败")).toBeTruthy();
    useFavoritesStore.setState({ ids: [] });
  });

  it("keeps the recurring series on the crypto tag, where the list itself is empty on the platform", async () => {
    const gateways = createTestGateways();
    const original = gateways.predict.listEvents.bind(gateways.predict);
    // 平台在 crypto 标签下只有周期单期事件，排除后列表为空
    gateways.predict.listEvents = async (query) =>
      query.tagId === "crypto"
        ? { items: [], nextCursor: null }
        : original(query);
    await renderWithProviders(
      <MarketListScreen {...props()} showPositionsEntry />,
      { gateways },
    );
    expect(await screen.findByTestId("predict-series")).toBeTruthy();
    await fireEvent.press(screen.getByText("加密"));
    expect(await screen.findByTestId("series-btc-updown-5m")).toBeTruthy();
    expect(screen.queryByTestId("predict-hero-ev-worldcup")).toBeNull();
    expect(screen.queryByText("暂无数据")).toBeNull();
    // 其它标签不带周期市场
    await fireEvent.press(screen.getByText("体育"));
    await waitFor(() =>
      expect(screen.queryByTestId("predict-series")).toBeNull(),
    );
  });

  it("lists recurring series and opens one", async () => {
    const p = props();
    await renderWithProviders(<MarketListScreen {...p} showPositionsEntry />);
    // 列表卡就能看出周期性：当期行下有"下一期 HH:MM"
    expect(await screen.findByTestId("series-next")).toBeTruthy();
    await fireEvent.press(await screen.findByTestId("series-btc-updown-5m"));
    expect(p.onOpenSeries).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "btc-updown-5m" }),
    );
  });

  it("shows the region banner and disables ordering when the region is restricted", async () => {
    useMockRuntime.getState().set({ regionRestricted: true });
    const p = props();
    await renderWithProviders(<MarketListScreen {...p} showPositionsEntry />);
    expect(await screen.findByTestId("region-notice-restricted")).toBeTruthy();
    expect(screen.getByText("您所在地区不支持交易")).toBeTruthy();
    expect(await screen.findByTestId("event-ev-btc-120k")).toBeTruthy();
    // 精选轮播、周期市场卡与列表卡上的买卖按钮全部禁用
    const buttons = screen.getAllByLabelText(/Yes/);
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons)
      expect(button.props.accessibilityState).toEqual({ disabled: true });
    useMockRuntime.getState().set({ regionRestricted: false });
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
