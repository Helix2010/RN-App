import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { fromDecimal } from "../../../core/money/money";
import { travelTestClock } from "../../../test/clock";
import {
  createTestGateways,
  renderWithProviders,
  signIn,
} from "../../../test/harness";
import { groupByDay, SeriesScreen } from "./series-screen";

// 价格图用手势 + reanimated，jest 的 reanimated mock 没有 useEvent：换成记录 props 的空组件
const mockLineChart = jest.fn();
jest.mock("../../../design-system/charts", () => ({
  ...jest.requireActual("../../../design-system/charts"),
  PriceLineChart: (props: unknown) => {
    mockLineChart(props);
    return null;
  },
}));

function props(extra: { periodMarketId?: string } = {}) {
  return {
    slug: "btc-updown-5m",
    onBack: jest.fn(),
    onOpenEvent: jest.fn(),
    onOpenTransfer: jest.fn(),
    ...extra,
  };
}

const WINDOW_MS = 5 * 60_000;
/** 夹具的分期 id / 市场 id 由窗口起点决定（features/predict/fixtures/series.ts）；时钟是测试锚定的 Date.now() */
const periodId = (offset: number) =>
  `series-btc-5m-${(Math.floor(Date.now() / WINDOW_MS) + offset) * WINDOW_MS}`;
const phaseText = () =>
  screen.getByTestId("series-period-phase").props.children as string;
const orderDisabled = (id: string) =>
  screen.getByTestId(id).props.accessibilityState?.disabled as boolean;

describe("SeriesScreen periods", () => {
  // 单个用例会快进测试时钟（travelTestClock）；setup 在每个用例前重新锚定

  it("quotes the order book on the 涨 / 跌 buttons, same as the order sheet, and shows the book expanded", async () => {
    const gateways = createTestGateways();
    const book = await gateways.predict.getOrderBook(`m-${periodId(0)}`);
    const bestAsk = book.asks[0]!.priceCents;
    const bestBid = book.bids[0]!.priceCents;
    await renderWithProviders(<SeriesScreen {...props()} />, { gateways });
    await screen.findByTestId("series-rail");
    // 买涨看卖一、买跌看 100 − 买一（与下单弹层同一口径），而不是平台事件价
    await waitFor(() =>
      expect(
        screen.getByTestId("series-order-up").props.accessibilityLabel,
      ).toContain(`${bestAsk}¢`),
    );
    expect(
      screen.getByTestId("series-order-down").props.accessibilityLabel,
    ).toContain(`${Math.round((100 - bestBid) * 10) / 10}¢`);
    expect(screen.queryByTestId("series-no-quote")).toBeNull();
    // 盘口默认展开
    expect(screen.getByTestId("series-book-card")).toBeTruthy();
    expect(screen.getByTestId("order-book")).toBeTruthy();
  });

  it("follows the live window by default and lets me pre-order the next one, then come back", async () => {
    const { runtime } = await renderWithProviders(
      <SeriesScreen {...props()} />,
    );
    await screen.findByTestId("series-rail");
    await waitFor(() =>
      expect(phaseText()).toBe(runtime.t("predict.series.live")),
    );
    // 当期没有"回到当期"；轨道上有历史 3 期 + 当期 + 未来 3 期 + "更多"
    expect(screen.queryByTestId("series-back-current")).toBeNull();
    expect(screen.getByTestId("series-rail-more")).toBeTruthy();
    expect(screen.getByTestId(`series-chip-${periodId(-3)}`)).toBeTruthy();
    expect(screen.queryByTestId(`series-chip-${periodId(-4)}`)).toBeNull();

    await fireEvent.press(screen.getByTestId(`series-chip-${periodId(1)}`));
    expect(phaseText()).toBe(runtime.t("predict.series.upcoming"));
    // 未来期：参考价"开盘时确定"、可提前下注（平台 acceptingOrders）
    expect(
      screen.getByText(runtime.t("predict.series.priceAtOpen")),
    ).toBeTruthy();
    expect(screen.getByText(runtime.t("predict.series.preOrder"))).toBeTruthy();
    expect(orderDisabled("series-order-up")).toBe(false);
    expect(screen.queryByTestId("series-live-price")).toBeNull();

    await fireEvent.press(screen.getByTestId("series-back-current"));
    expect(phaseText()).toBe(runtime.t("predict.series.live"));
  });

  it("links to the period detail from a link row, groups history by day with settlement deltas and ends with a footer", async () => {
    const screenProps = props();
    const { runtime } = await renderWithProviders(
      <SeriesScreen {...screenProps} />,
    );
    await screen.findByTestId("series-rail");
    // 三级动作：详情是链接行而不是灰按钮；轨道两端是带无障碍标签的图标按钮
    await fireEvent.press(await screen.findByTestId("series-open-detail"));
    expect(screenProps.onOpenEvent).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId("series-rail-earlier").props.accessibilityLabel,
    ).toBe(runtime.t("predict.series.earlierIcon"));
    expect(
      screen.getByTestId("series-rail-more").props.accessibilityLabel,
    ).toBe(runtime.t("predict.series.moreIcon"));
    // 历史：按天分组、行内不再重复日期、右侧有结算变动额、底部是脚注而不是大按钮
    expect(
      screen.getAllByTestId(/^series-history-day-/).length,
    ).toBeGreaterThan(0);
    const delta = screen.getByTestId(`series-period-delta-${periodId(-1)}`)
      .props.children as string;
    expect(delta).toMatch(/^[+-]\$\d/);
    expect(screen.getByTestId("series-history-footer")).toBeTruthy();
    expect(screen.queryByTestId("series-history-more")).toBeNull();
  });

  it("shows a settled window as a result panel without order buttons", async () => {
    const { runtime } = await renderWithProviders(
      <SeriesScreen {...props()} />,
    );
    const row = await screen.findByTestId(`series-period-${periodId(-1)}`);
    await fireEvent.press(row);
    expect([
      runtime.t("predict.series.up"),
      runtime.t("predict.series.down"),
    ]).toContain(phaseText());
    expect(screen.queryByTestId("series-order-up")).toBeNull();
    expect(screen.queryByTestId("series-book-card")).toBeNull();
    expect(
      screen.getByText(runtime.t("predict.series.finalPrice")),
    ).toBeTruthy();
    expect(screen.getByTestId("series-back-current")).toBeTruthy();
  });

  it("locates the window a position came from, and says so when it is gone", async () => {
    await renderWithProviders(
      <SeriesScreen {...props({ periodMarketId: `m-${periodId(-2)}` })} />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("series-period-card").props.accessibilityState,
      ).toBeUndefined(),
    );
    await waitFor(() =>
      expect(screen.getByTestId("series-back-current")).toBeTruthy(),
    );
    expect(
      screen.getByTestId(`series-period-${periodId(-2)}`).props
        .accessibilityState,
    ).toEqual({ selected: true });
    expect(screen.queryByTestId("series-locate-missing")).toBeNull();

    await screen.unmount();
    await renderWithProviders(
      <SeriesScreen {...props({ periodMarketId: "m-gone" })} />,
    );
    expect(await screen.findByTestId("series-locate-missing")).toBeTruthy();
    expect(screen.queryByTestId("series-back-current")).toBeNull();
  });

  it("shows my position on the selected window and lets me claim once it settles", async () => {
    const gateways = createTestGateways();
    const session = await signIn(gateways);
    const marketId = `m-${periodId(0)}`;
    await gateways.predict.placeOrder(session.address, {
      marketId,
      outcome: "yes",
      side: "buy",
      type: "market",
      amount: fromDecimal("10", 6, "USDW"),
    });
    const { runtime } = await renderWithProviders(
      <SeriesScreen {...props()} />,
      { gateways },
    );
    expect(await screen.findByTestId("series-position-live")).toBeTruthy();
    expect(screen.getByTestId(`series-chip-held-${periodId(0)}`)).toBeTruthy();
    await screen.unmount();

    // 快进 20 分钟：那期结束、提案、零争议期 → 结算；夹具 Yes 52¢ ≥ 50 → 涨方赢
    travelTestClock(4 * WINDOW_MS);
    await renderWithProviders(
      <SeriesScreen {...props({ periodMarketId: marketId })} />,
      { gateways },
    );
    const claim = await screen.findByTestId(/^series-claim-/);
    expect(screen.getByText(/可领取/)).toBeTruthy();
    await fireEvent.press(claim);
    expect(await screen.findByTestId("series-position-claimed")).toBeTruthy();
    expect(runtime.t("predict.series.positionClaimed")).toBe("已领取");
  });
});

describe("SeriesScreen chart", () => {
  beforeEach(() => mockLineChart.mockClear());

  it("shows the live price with the price-to-beat baseline and switches between the three chart modes", async () => {
    await renderWithProviders(<SeriesScreen {...props()} />);
    expect(await screen.findByTestId("series-chart")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("series-live-price").props.children).not.toBe(
        "—",
      ),
    );
    // 价格图：一条线 + 参考价基准线
    await waitFor(() =>
      expect(
        mockLineChart.mock.calls.some(
          (call) =>
            (call[0] as { series: { key: string }[]; baseline?: number })
              .series[0]?.key === "price" &&
            typeof (call[0] as { baseline?: number }).baseline === "number",
        ),
      ).toBe(true),
    );
    expect(screen.getByTestId("series-live-delta")).toBeTruthy();
    await fireEvent.press(screen.getByText("K 线"));
    expect(await screen.findByTestId("series-candles")).toBeTruthy();
    await fireEvent.press(screen.getByText("概率"));
    await waitFor(() =>
      expect(
        mockLineChart.mock.calls.some(
          (call) =>
            (call[0] as { series: { key: string }[] }).series[0]?.key === "yes",
        ),
      ).toBe(true),
    );
  });

  it("explains instead of guessing when the series has no recognisable asset", async () => {
    const gateways = createTestGateways();
    const original = gateways.predict.getSeries.bind(gateways.predict);
    gateways.predict.getSeries = async (slug, id) => ({
      ...(await original(slug, id)),
      slug: "gold-updown-5m",
      ticker: null,
      title: { default: "Gold up or down" },
    });
    await renderWithProviders(<SeriesScreen {...props()} />, { gateways });
    expect(await screen.findByTestId("series-chart-unknown")).toBeTruthy();
    expect(screen.queryByTestId("series-live-price")).toBeNull();
  });
});

describe("groupByDay", () => {
  it("keeps order, groups consecutive rows by their end day and labels the day per locale", () => {
    const period = (id: string, end: string) =>
      ({ id, windowEnd: end }) as unknown as Parameters<
        typeof groupByDay
      >[0][number];
    const groups = groupByDay(
      [
        period("a", "2026-09-09T06:10:00Z"),
        period("b", "2026-09-09T06:05:00Z"),
        period("c", "2026-09-08T23:55:00Z"),
      ],
      "en-US",
    );
    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ["a", "b"],
      ["c"],
    ]);
    expect(groups[0]!.label).toMatch(/Sep/);
    expect(
      groupByDay([period("a", "2026-09-09T06:10:00Z")], "zh-CN")[0]!.label,
    ).toBe("9 月 9 日");
  });
});
