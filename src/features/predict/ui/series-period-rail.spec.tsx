import { fireEvent, screen } from "@testing-library/react-native";
import { renderWithProviders } from "../../../test/harness";
import type { SeriesPeriod } from "../model/predict";
import { HistoryFooter, settlementDelta } from "./series-period-rail";

const period = (reference: string | null, final: string | null): SeriesPeriod =>
  ({
    priceToBeat: reference === null ? null : { price: reference },
    finalPrice: final === null ? null : { price: final },
  }) as unknown as SeriesPeriod;

describe("settlementDelta", () => {
  it("is final minus reference, and nothing when either side is missing or not a number", () => {
    expect(settlementDelta(period("100.5", "142.5"))).toBe(42);
    expect(settlementDelta(period("100", "63"))).toBe(-37);
    expect(settlementDelta(period(null, "63"))).toBeNull();
    expect(settlementDelta(period("100", null))).toBeNull();
    expect(settlementDelta(period("n/a", "63"))).toBeNull();
  });
});

describe("HistoryFooter", () => {
  const base = {
    loading: false,
    error: false,
    hasMore: false,
    count: 12,
    onLoadMore: jest.fn(),
    onRetry: jest.fn(),
  };

  it("says everything is shown when there is no more history", async () => {
    const { runtime } = await renderWithProviders(<HistoryFooter {...base} />);
    expect(screen.getByText(/12/)).toBeTruthy();
    expect(
      screen.queryByText(runtime.t("predict.series.loadEarlier")),
    ).toBeNull();
  });

  it("offers a text link when more pages exist and the caller does not auto-load, a hint when it does", async () => {
    const onLoadMore = jest.fn();
    const { runtime } = await renderWithProviders(
      <HistoryFooter {...base} hasMore onLoadMore={onLoadMore} />,
    );
    await fireEvent.press(
      screen.getByText(runtime.t("predict.series.loadEarlier")),
    );
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    await screen.unmount();
    await renderWithProviders(<HistoryFooter {...base} hasMore autoLoads />);
    expect(
      screen.getByText(runtime.t("predict.series.scrollForEarlier")),
    ).toBeTruthy();
  });

  it("shows loading and a retry link on failure", async () => {
    const onRetry = jest.fn();
    const { runtime } = await renderWithProviders(
      <HistoryFooter {...base} loading />,
    );
    expect(
      screen.getByText(runtime.t("predict.series.loadingEarlier")),
    ).toBeTruthy();
    await screen.unmount();
    await renderWithProviders(
      <HistoryFooter {...base} error onRetry={onRetry} />,
    );
    await fireEvent.press(
      screen.getByText(runtime.t("predict.series.loadFailed")),
    );
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
