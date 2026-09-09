import {
  DEFAULT_FILTERS,
  activeFilterSummary,
  isDiscovery,
  selectPrimary,
  selectSecondary,
  seriesMatchesTag,
  showSeriesFor,
} from "./filter-state";
import type { Series, Tag } from "./predict";

const crypto: Tag = {
  id: "430",
  slug: "crypto",
  label: { en: "Crypto" },
  order: 1,
};
const series = (recurrence: string) =>
  ({ id: "s", slug: "btc-updown", recurrence }) as unknown as Series;

describe("filter-state", () => {
  it("defaults to the whole site with discovery on, and any narrowing turns discovery off", () => {
    expect(isDiscovery(DEFAULT_FILTERS)).toBe(true);
    expect(isDiscovery({ ...DEFAULT_FILTERS, view: "closed" })).toBe(false);
    expect(isDiscovery({ ...DEFAULT_FILTERS, favorites: true })).toBe(false);
    expect(isDiscovery({ ...DEFAULT_FILTERS, q: "btc" })).toBe(false);
    expect(isDiscovery(selectPrimary(DEFAULT_FILTERS, "430"))).toBe(false);
  });

  it("selecting a primary resets the secondary, search and favorites but keeps view and sort", () => {
    const narrowed = selectPrimary(
      {
        ...DEFAULT_FILTERS,
        q: "x",
        favorites: true,
        view: "closed",
        sort: "newest",
      },
      "430",
    );
    expect(narrowed).toMatchObject({
      tag: "430",
      parentTag: "430",
      q: "",
      favorites: false,
      view: "closed",
      sort: "newest",
    });
    const child = selectSecondary(narrowed, "490");
    expect(child).toMatchObject({ tag: "490", parentTag: "430" });
    expect(selectSecondary(child, null)).toMatchObject({
      tag: "430",
      parentTag: "430",
    });
    expect(selectPrimary(child, null)).toMatchObject({
      tag: null,
      parentTag: null,
    });
  });

  it("shows recurring series on the whole site and under crypto only", () => {
    expect(showSeriesFor(DEFAULT_FILTERS, undefined)).toBe(true);
    expect(showSeriesFor(selectPrimary(DEFAULT_FILTERS, "430"), crypto)).toBe(
      true,
    );
    expect(
      showSeriesFor(selectPrimary(DEFAULT_FILTERS, "209"), {
        ...crypto,
        id: "209",
        slug: "politics",
      }),
    ).toBe(false);
    expect(
      showSeriesFor({ ...DEFAULT_FILTERS, view: "closed" }, undefined),
    ).toBe(false);
  });

  it("matches crypto secondary tags to series recurrence, tolerating daily spellings", () => {
    expect(seriesMatchesTag(series("5m"), "5m")).toBe(true);
    expect(seriesMatchesTag(series("5m"), "15m")).toBe(false);
    expect(seriesMatchesTag(series("1d"), "daily")).toBe(true);
    expect(seriesMatchesTag(series("1H"), "1h")).toBe(true);
  });

  it("summarises only non-default view and sort", () => {
    const labels = {
      view: (v: string) => `v:${v}`,
      sort: (s: string) => `s:${s}`,
    };
    expect(activeFilterSummary(DEFAULT_FILTERS, labels)).toBeNull();
    expect(
      activeFilterSummary({ ...DEFAULT_FILTERS, view: "closed" }, labels),
    ).toBe("v:closed");
    expect(
      activeFilterSummary(
        { ...DEFAULT_FILTERS, view: "closed", sort: "newest" },
        labels,
      ),
    ).toBe("v:closed · s:newest");
  });
});
