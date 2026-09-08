import { screen, waitFor } from "@testing-library/react-native";
import { useMockRuntime } from "../../../core/mock/mock-runtime";
import { createTestGateways, renderWithProviders } from "../../../test/harness";
import type { PredictEvent } from "../model/predict";
import { EventDetailScreen } from "./event-detail-screen";

// 价格图用手势 + reanimated，jest 里的 reanimated mock 没有 useEvent：图表不是本用例的对象，换成空组件
jest.mock("../../../design-system/charts", () => ({
  ...jest.requireActual("../../../design-system/charts"),
  PriceLineChart: () => null,
}));

function props() {
  return {
    eventId: "ev-btc-120k",
    onBack: jest.fn(),
    onOpenSettlement: jest.fn(),
    onOpenTransfer: jest.fn(),
  };
}

describe("EventDetailScreen", () => {
  it("shows tags, 24h volume / liquidity and the favorite star for a trading market", async () => {
    await renderWithProviders(<EventDetailScreen {...props()} />);
    expect(await screen.findByTestId("detail-tags")).toBeTruthy();
    expect(screen.getByTestId("favorite-ev-btc-120k")).toBeTruthy();
    expect(screen.queryByTestId("detail-not-accepting")).toBeNull();
    expect(screen.getByTestId("detail-yes").props.accessibilityState).toEqual({
      disabled: false,
    });
  });

  it("closes every order entry when the platform is not accepting orders", async () => {
    const gateways = createTestGateways();
    const original = gateways.predict.getEvent.bind(gateways.predict);
    gateways.predict.getEvent = async (id: string): Promise<PredictEvent> => {
      const event = await original(id);
      return {
        ...event,
        markets: event.markets.map((market) => ({
          ...market,
          acceptingOrders: false,
        })),
      };
    };
    await renderWithProviders(<EventDetailScreen {...props()} />, { gateways });
    expect(await screen.findByTestId("detail-not-accepting")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("detail-yes").props.accessibilityState).toEqual(
        { disabled: true },
      ),
    );
    // 底栏的"买 Yes / 买 No"随之消失
    expect(screen.queryByText(/^Buy Yes|^买 Yes/)).toBeNull();
  });

  it("closes ordering with an explanation when the region is restricted", async () => {
    useMockRuntime.getState().set({ regionRestricted: true });
    await renderWithProviders(<EventDetailScreen {...props()} />);
    expect(await screen.findByTestId("region-notice-restricted")).toBeTruthy();
    expect(
      screen.getByText("您所在地区因监管要求不支持预测市场。"),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("detail-yes").props.accessibilityState).toEqual(
        { disabled: true },
      ),
    );
    useMockRuntime.getState().set({ regionRestricted: false });
  });

  it("keeps ordering closed with a retry when the region check fails", async () => {
    const gateways = createTestGateways();
    gateways.predict.checkRegion = async () => {
      throw new Error("geo service down");
    };
    await renderWithProviders(<EventDetailScreen {...props()} />, { gateways });
    expect(await screen.findByTestId("region-notice-unknown")).toBeTruthy();
    expect(screen.getByTestId("region-retry")).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId("detail-yes").props.accessibilityState).toEqual(
        { disabled: true },
      ),
    );
  });
});
