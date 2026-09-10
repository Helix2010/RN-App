import { act, screen, waitFor } from "@testing-library/react-native";
import {
  createTestGateways,
  renderWithProviders,
  signIn,
} from "../../test/harness";
import type { Page } from "../../core/gateways/types";
import type { PredictEvent } from "../predict/model/predict";
import { FoundationHomeScreen } from "./foundation-home-screen";

function props() {
  return {
    onOpenAssets: jest.fn(),
    onOpenProfile: jest.fn(),
    onOpenPredict: jest.fn(),
    onOpenPredictPositions: jest.fn(),
    onOpenLeaderboard: jest.fn(),
    onOpenDex: jest.fn(),
    onOpenSwap: jest.fn(),
  };
}

describe("FoundationHomeScreen", () => {
  it("shows the guest welcome card and hides the notification bell", async () => {
    const { runtime } = await renderWithProviders(
      <FoundationHomeScreen {...props()} />,
    );
    expect(await screen.findByTestId("guest-connect")).toBeTruthy();
    expect(screen.getByTestId("guest-create")).toBeTruthy();
    expect(screen.queryByLabelText(runtime.t("home.notifications"))).toBeNull();
  });

  it("swaps in the portfolio card and account chip after signing in", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    const { runtime } = await renderWithProviders(
      <FoundationHomeScreen {...props()} />,
      { gateways },
    );
    await waitFor(() =>
      expect(screen.getByTestId("home-account")).toBeTruthy(),
    );
    expect(screen.queryByTestId("guest-connect")).toBeNull();
    expect(screen.getByLabelText(runtime.t("home.notifications"))).toBeTruthy();
  });

  it("holds the hot-predictions carousel with skeleton cards until the events land", async () => {
    const gateways = createTestGateways();
    const listEvents = gateways.predict.listEvents.bind(gateways.predict);
    let release: () => void = () => {};
    gateways.predict.listEvents = (query) =>
      new Promise<Page<PredictEvent>>((resolve) => {
        release = () => resolve(listEvents(query));
      });
    await renderWithProviders(<FoundationHomeScreen {...props()} />, {
      gateways,
    });
    // 骨架卡和真卡挂在同一个轮播上：轮播在骨架阶段就把宽度量好，数据到了不重新测宽
    expect(await screen.findByTestId("home-predict-carousel")).toBeTruthy();
    expect(
      screen.getAllByTestId("home-predict-skeleton").length,
    ).toBeGreaterThan(0);

    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(screen.queryByTestId("home-predict-skeleton")).toBeNull(),
    );
    expect(screen.getByTestId("home-predict-carousel")).toBeTruthy();
  });

  it("renders only the enabled module sections", async () => {
    const { runtime } = await renderWithProviders(
      <FoundationHomeScreen {...props()} />,
      {
        modules: { dex: false },
      },
    );
    expect(await screen.findByText(runtime.t("home.predict"))).toBeTruthy();
    expect(screen.queryByText(runtime.t("home.dexHotTokens"))).toBeNull();
  });

  it("renders DEX hot tokens with formatted prices when Predict is off", async () => {
    const { runtime } = await renderWithProviders(
      <FoundationHomeScreen {...props()} />,
      {
        modules: { predict: false },
      },
    );
    expect(
      await screen.findByText(runtime.t("home.dexHotTokens")),
    ).toBeTruthy();
    expect(screen.queryByText(runtime.t("home.predict"))).toBeNull();
    await waitFor(() => expect(screen.getByText("PEPE")).toBeTruthy());
  });

  it("never asks the platform for prediction events while Predict is off", async () => {
    const gateways = createTestGateways();
    const listEvents = jest.spyOn(gateways.predict, "listEvents");
    await renderWithProviders(<FoundationHomeScreen {...props()} />, {
      gateways,
      modules: { predict: false },
    });
    await waitFor(() => expect(screen.getByText("PEPE")).toBeTruthy());
    expect(listEvents).not.toHaveBeenCalled();
  });
});
