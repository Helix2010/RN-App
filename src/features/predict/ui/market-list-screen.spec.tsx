import {
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { fromDecimal } from "../../../core/money/money";
import {
  createTestGateways,
  renderWithProviders,
  signIn,
} from "../../../test/harness";
import type { InMemoryPredictAccountGateway } from "../../../test/predict-account";
import { useMockRuntime } from "../../../core/mock/mock-runtime";
import { EVENTS, EXTRA_TAGS } from "../fixtures/events";
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

  it("renders one featured card without a carousel and a single rank block with tabs, deduped against the hero", async () => {
    const gateways = createTestGateways();
    const worldcup = EVENTS.find((event) => event.id === "ev-worldcup")!;
    // 运营位：1 个 hero、2 个 highlight（其中一个与 hero 重复）、其余 normal
    gateways.predict.listCuratedEvents = async () =>
      EVENTS.map((event, index) => ({
        event,
        hero: event.id === worldcup.id ? 0 : null,
        highlight:
          event.id === worldcup.id || event.id === "ev-btc-120k" ? index : null,
        normal:
          event.id === worldcup.id || event.id === "ev-btc-120k" ? null : index,
      }));
    const { runtime } = await renderWithProviders(
      <MarketListScreen {...props()} showPositionsEntry />,
      { gateways },
    );
    expect(await screen.findByTestId("predict-hero-ev-worldcup")).toBeTruthy();
    // 只有一个 hero：不套轮播、没有页点
    expect(screen.queryByTestId("predict-featured-carousel")).toBeNull();
    expect(
      screen.queryByTestId("carousel-dots", { includeHiddenElements: true }),
    ).toBeNull();
    expect(screen.getByText(runtime.t("predict.curation.title"))).toBeTruthy();
    // 榜单合成一个区块，tab 切换；hero 不进任何榜
    expect(await screen.findByTestId("predict-rank-tabs")).toBeTruthy();
    expect(screen.getByTestId("predict-rank-hotPicks")).toBeTruthy();
    expect(screen.getByTestId("predict-rank-row-ev-btc-120k")).toBeTruthy();
    expect(screen.queryByTestId("predict-rank-row-ev-worldcup")).toBeNull();
    await fireEvent.press(screen.getByTestId("predict-rank-tab-breaking"));
    const breaking = screen.getByTestId("predict-rank-breaking");
    expect(screen.queryByTestId("predict-rank-hotPicks")).toBeNull();
    // 一个事件只出现在一个榜里：热门精选里的 btc 不再进"突发"
    expect(
      within(breaking).queryByTestId("predict-rank-row-ev-btc-120k"),
    ).toBeNull();
    expect(
      within(breaking).queryAllByTestId(/^predict-rank-row-/).length,
    ).toBeLessThanOrEqual(5);
  });

  it("uses the snap carousel with dots when the platform curates several heroes", async () => {
    const gateways = createTestGateways();
    gateways.predict.listCuratedEvents = async () =>
      EVENTS.slice(0, 2).map((event, index) => ({
        event,
        hero: index,
        highlight: null,
        normal: null,
      }));
    await renderWithProviders(
      <MarketListScreen {...props()} showPositionsEntry />,
      { gateways },
    );
    expect(await screen.findByTestId("predict-featured-carousel")).toBeTruthy();
    // 页点对无障碍隐藏，查询时要带 includeHiddenElements
    expect(
      screen.getByTestId("carousel-dots", { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.getByTestId(`predict-hero-${EVENTS[0]!.id}`)).toBeTruthy();
    // 两个 hero 不进本地榜
    await waitFor(() =>
      expect(screen.getByTestId("predict-rank-boards")).toBeTruthy(),
    );
    expect(
      screen.queryByTestId(`predict-rank-row-${EVENTS[0]!.id}`),
    ).toBeNull();
    expect(
      screen.queryByTestId(`predict-rank-row-${EVENTS[1]!.id}`),
    ).toBeNull();
  });

  it("searches the whole platform once two characters are typed and offers matching tags", async () => {
    await renderWithProviders(
      <MarketListScreen {...props()} showPositionsEntry />,
    );
    expect(await screen.findByTestId("event-ev-btc-120k")).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId("predict-search"), "FOMC");
    // 搜索态：筛选行收起、策展收起，结果来自服务端搜索
    await waitFor(() =>
      expect(screen.queryByTestId("event-ev-btc-120k")).toBeNull(),
    );
    expect(await screen.findByTestId("event-ev-fomc-sep")).toBeTruthy();
    expect(screen.queryByTestId("predict-tags")).toBeNull();
    expect(screen.queryByTestId("predict-hero-ev-worldcup")).toBeNull();
    await fireEvent.changeText(screen.getByTestId("predict-search"), "加密");
    // 命中标签：点标签就切到该分类并退出搜索
    await fireEvent.press(
      await screen.findByTestId("predict-search-tag-crypto"),
    );
    expect(await screen.findByTestId("predict-tags")).toBeTruthy();
    expect(screen.getByTestId("predict-search").props.value).toBe("");
    await fireEvent.changeText(
      screen.getByTestId("predict-search"),
      "zzz-nothing",
    );
    expect(await screen.findByTestId("predict-search-empty")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("predict-search-cancel"));
    expect(await screen.findByTestId("event-ev-btc-120k")).toBeTruthy();
  });

  it("defaults to all markets, switches the view to closed and shows the active-filter banner", async () => {
    await renderWithProviders(
      <MarketListScreen {...props()} showPositionsEntry />,
    );
    expect(await screen.findByTestId("predict-hero-ev-worldcup")).toBeTruthy();
    expect(await screen.findByTestId("predict-series")).toBeTruthy();
    // 默认"全部"：不同分类的事件同时在列表里
    expect(screen.getByTestId("event-ev-btc-120k")).toBeTruthy();
    expect(screen.getByTestId("event-ev-fomc-sep")).toBeTruthy();
    expect(screen.queryByTestId("predict-filter-banner")).toBeNull();
    await fireEvent.press(screen.getByTestId("predict-view"));
    await fireEvent.press(screen.getByTestId("predict-view-option-closed"));
    // 已结束：精选 / 周期市场收起，横幅说明当前筛选
    expect(await screen.findByTestId("event-ev-mun-liv")).toBeTruthy();
    expect(screen.queryByTestId("event-ev-btc-120k")).toBeNull();
    expect(screen.queryByTestId("predict-hero-ev-worldcup")).toBeNull();
    expect(screen.queryByTestId("predict-series")).toBeNull();
    expect(screen.getByTestId("predict-filter-banner")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("predict-tag-sports"));
    expect(await screen.findByTestId("event-ev-mun-liv")).toBeTruthy();
    expect(screen.queryByTestId("event-ev-worldcup")).toBeNull();
    await fireEvent.press(screen.getByTestId("predict-filter-banner-clear"));
    expect(await screen.findByTestId("event-ev-worldcup")).toBeTruthy();
    expect(screen.queryByTestId("predict-filter-banner")).toBeNull();
  });

  it("shows favorites only after the star was toggled on a card", async () => {
    useFavoritesStore.setState({ ids: [] });
    const p = props();
    await renderWithProviders(<MarketListScreen {...p} showPositionsEntry />);
    expect(await screen.findByTestId("event-ev-btc-120k")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("predict-favorites"));
    expect(await screen.findByTestId("predict-favorites-empty")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("predict-favorites"));
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
    await fireEvent.press(screen.getByTestId("predict-tag-crypto"));
    expect(await screen.findByTestId("series-btc-updown-5m")).toBeTruthy();
    expect(screen.queryByTestId("predict-hero-ev-worldcup")).toBeNull();
    expect(screen.queryByTestId("predict-empty")).toBeNull();
    // crypto 的二级标签：按周期粒度过滤系列卡
    expect(await screen.findByTestId("predict-subtag-15m")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("predict-subtag-15m"));
    await waitFor(() =>
      expect(screen.queryByTestId("series-btc-updown-5m")).toBeNull(),
    );
    // 15 分钟下既没有系列也没有事件：空分类卡
    expect(await screen.findByTestId("predict-empty")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("predict-subtag-5m"));
    expect(await screen.findByTestId("series-btc-updown-5m")).toBeTruthy();
    // 其它标签不带周期市场，也没有二级标签
    await fireEvent.press(screen.getByTestId("predict-tag-sports"));
    await waitFor(() =>
      expect(screen.queryByTestId("predict-series")).toBeNull(),
    );
    expect(screen.queryByTestId("predict-subtags")).toBeNull();
  });

  it("shows the empty-category card with a way back to all markets", async () => {
    const gateways = createTestGateways();
    gateways.predict.listEvents = async () => ({ items: [], nextCursor: null });
    await renderWithProviders(
      <MarketListScreen {...props()} showPositionsEntry />,
      { gateways },
    );
    await fireEvent.press(await screen.findByTestId("predict-tag-politics"));
    expect(await screen.findByTestId("predict-empty")).toBeTruthy();
    expect(screen.getByText("政治 暂无交易中的市场")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("predict-empty-all"));
    await waitFor(() =>
      expect(screen.queryByTestId("predict-empty")).toBeNull(),
    );
  });

  it("keeps every carousel tag inline and hides 更多 when the overflow would hold a single tag", async () => {
    // 夹具 9 个轮播标签 = 上限 8 + 1：全部内联，不为一个标签开面板
    await renderWithProviders(
      <MarketListScreen {...props()} showPositionsEntry />,
    );
    expect(await screen.findByTestId("predict-tag-culture")).toBeTruthy();
    expect(screen.queryByTestId("predict-tag-more")).toBeNull();
  });

  it("moves carousel tags past the inline limit into 更多 and pins the picked one into the row", async () => {
    const gateways = createTestGateways();
    const carousel = await gateways.predict.listTags();
    gateways.predict.listTags = async () => [...carousel, ...EXTRA_TAGS];
    await renderWithProviders(
      <MarketListScreen {...props()} showPositionsEntry />,
      { gateways },
    );
    // 前 8 个内联（… tech），第 9 个起（culture、oil …）进"更多"
    expect(await screen.findByTestId("predict-tag-tech")).toBeTruthy();
    expect(screen.queryByTestId("predict-tag-culture")).toBeNull();
    await fireEvent.press(screen.getByTestId("predict-tag-more"));
    await fireEvent.press(
      await screen.findByTestId("predict-tag-picker-item-oil"),
    );
    // 溢出标签选中后以选中态插到行尾；策展位随之收起
    expect(await screen.findByTestId("predict-tag-oil")).toBeTruthy();
    expect(screen.queryByTestId("predict-hero-ev-worldcup")).toBeNull();
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
