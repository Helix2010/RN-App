import { deriveBookView } from "./order-book-view";
import type { OrderBook } from "./predict";

const book: OrderBook = {
  marketId: "m",
  bids: [
    { priceCents: 60, shares: 100 },
    { priceCents: 59, shares: 50 },
    { priceCents: 58, shares: 25 },
  ],
  asks: [
    { priceCents: 62, shares: 40 },
    { priceCents: 63, shares: 60 },
  ],
  tickCents: 1,
  minOrderShares: 5,
  lastTradeCents: 61,
  updatedAt: "2026-09-05T00:00:00.000Z",
};

describe("deriveBookView", () => {
  it("stacks asks far-to-near above bids near-to-far with cumulative dollar totals", () => {
    const view = deriveBookView(book, "yes");
    expect(view.asks.map((row) => row.priceCents)).toEqual([63, 62]);
    expect(view.bids.map((row) => row.priceCents)).toEqual([60, 59, 58]);
    // 卖一 62 × 40 = $24.8，累计到 63 再加 63 × 60 = $37.8 → $62.6
    expect(view.asks[1]?.totalUsd).toBeCloseTo(24.8);
    expect(view.asks[0]?.totalUsd).toBeCloseTo(62.6);
    expect(view.asks[0]?.barPct).toBe(100);
    expect(view.bids[0]?.totalUsd).toBeCloseTo(60);
    expect(view.bestBid).toBe(60);
    expect(view.bestAsk).toBe(62);
    expect(view.spreadCents).toBe(2);
    expect(view.lastCents).toBe(61);
  });

  it("mirrors the YES book for the No side", () => {
    const view = deriveBookView(book, "no");
    // Yes 的卖单 62 / 63 是 No 的买单 38 / 37；Yes 的买单 60 / 59 / 58 是 No 的卖单 40 / 41 / 42
    expect(view.bids.map((row) => row.priceCents)).toEqual([38, 37]);
    expect(view.asks.map((row) => row.priceCents)).toEqual([42, 41, 40]);
    expect(view.bestBid).toBe(38);
    expect(view.bestAsk).toBe(40);
    expect(view.lastCents).toBe(39);
  });

  it("keeps only the nearest levels per side", () => {
    const view = deriveBookView(book, "yes", 1);
    expect(view.asks.map((row) => row.priceCents)).toEqual([62]);
    expect(view.bids.map((row) => row.priceCents)).toEqual([60]);
  });

  it("reports missing quotes as null instead of zero", () => {
    const empty = deriveBookView(
      { ...book, bids: [], asks: [], lastTradeCents: null },
      "yes",
    );
    expect(empty.bestBid).toBeNull();
    expect(empty.spreadCents).toBeNull();
    expect(empty.lastCents).toBeNull();
  });
});
