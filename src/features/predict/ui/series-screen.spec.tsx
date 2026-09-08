import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { createTestGateways, renderWithProviders } from "../../../test/harness";
import { SeriesScreen } from "./series-screen";

// 价格图用手势 + reanimated，jest 的 reanimated mock 没有 useEvent：换成记录 props 的空组件
const mockLineChart = jest.fn();
jest.mock("../../../design-system/charts", () => ({
  ...jest.requireActual("../../../design-system/charts"),
  PriceLineChart: (props: unknown) => {
    mockLineChart(props);
    return null;
  },
}));

function props() {
  return { slug: "btc-updown-5m", onBack: jest.fn(), onOpenEvent: jest.fn() };
}

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
