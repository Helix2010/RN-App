import { EVENTS } from "../fixtures/events";
import {
  matchesEventSearch,
  topByProbability,
  topByVolume24h,
} from "./event-search";

const btc = EVENTS.find((event) => event.id === "ev-btc-120k")!;
const fomc = EVENTS.find((event) => event.id === "ev-fomc-sep")!;

describe("event search", () => {
  it("matches any language of the title, tags, questions and outcome labels", () => {
    expect(matchesEventSearch(btc, "")).toBe(true);
    expect(matchesEventSearch(btc, "  ")).toBe(true);
    expect(matchesEventSearch(btc, "btc")).toBe(true);
    expect(matchesEventSearch(btc, "BTC")).toBe(true);
    expect(matchesEventSearch(btc, "比特币")).toBe(
      JSON.stringify(btc.title).includes("比特币") ||
        btc.markets.some((market) =>
          JSON.stringify(market.question).includes("比特币"),
        ),
    );
    const tagText = Object.values(btc.tags[0]?.label ?? {})[0];
    if (tagText) expect(matchesEventSearch(btc, tagText)).toBe(true);
    const outcome = Object.values(fomc.markets[0]!.outcomeLabel ?? {})[0]!;
    expect(matchesEventSearch(fomc, outcome)).toBe(true);
    expect(matchesEventSearch(btc, "zzz-no-such-market")).toBe(false);
  });

  it("ranks by highest yes price and by 24h volume", () => {
    const byProbability = topByProbability(EVENTS, 3);
    expect(byProbability).toHaveLength(3);
    expect(byProbability[0]!.cents).toBeGreaterThanOrEqual(
      byProbability[1]!.cents,
    );
    expect(byProbability[1]!.cents).toBeGreaterThanOrEqual(
      byProbability[2]!.cents,
    );
    const byVolume = topByVolume24h(EVENTS, 3);
    expect(byVolume).toHaveLength(3);
    expect(byVolume[0]!.volume24hUsd).toBeGreaterThanOrEqual(
      byVolume[1]!.volume24hUsd,
    );
    expect(topByVolume24h([{ ...btc, volume24hUsd: 0 }], 3)).toEqual([]);
    expect(
      topByProbability(
        [
          {
            ...btc,
            markets: btc.markets.map((market) => ({
              ...market,
              yesPriceCents: null,
            })),
          },
        ],
        3,
      ),
    ).toEqual([]);
  });
});
