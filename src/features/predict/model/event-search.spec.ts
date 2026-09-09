import { EVENTS } from "../fixtures/events";
import {
  buildRankBoards,
  curationZone,
  matchesEventSearch,
  topByProbability,
  topByVolume24h,
  topYesCents,
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

describe("curation zones", () => {
  const [a, b, c, d] = EVENTS;
  const items = [
    { event: a!, hero: 2, highlight: null, normal: 0 },
    { event: b!, hero: 1, highlight: 5, normal: null },
    { event: c!, hero: null, highlight: 5, normal: 1 },
    { event: d!, hero: null, highlight: null, normal: null },
  ];

  it("orders each zone by the operator rank, ties by numeric id, and skips events outside the zone", () => {
    expect(curationZone(items, "hero").map((e) => e.id)).toEqual([
      b!.id,
      a!.id,
    ]);
    // 同位次按 id 排（字符串 id 里的数字按数值比）
    const tie = [b!, c!].sort((x, y) =>
      x.id.localeCompare(y.id, undefined, { numeric: true }),
    );
    expect(curationZone(items, "highlight").map((e) => e.id)).toEqual(
      tie.map((e) => e.id),
    );
    expect(curationZone(items, "normal", 1).map((e) => e.id)).toEqual([a!.id]);
    expect(curationZone([], "hero")).toEqual([]);
  });

  it("reports the top yes price per event or null without quotes", () => {
    expect(topYesCents(a!)).toBe(
      Math.max(...a!.markets.map((m) => m.yesPriceCents ?? -1)),
    );
    expect(
      topYesCents({
        ...a!,
        markets: a!.markets.map((m) => ({ ...m, yesPriceCents: null })),
      }),
    ).toBeNull();
  });
});

describe("rank boards", () => {
  const [a, b, c, d, e] = EVENTS as [
    (typeof EVENTS)[number],
    (typeof EVENTS)[number],
    (typeof EVENTS)[number],
    (typeof EVENTS)[number],
    (typeof EVENTS)[number],
  ];

  it("drops hero events, keeps each event in its highest-priority board and skips empty boards", () => {
    const boards = buildRankBoards(
      {
        heroIds: new Set([a.id]),
        hotPicks: [a, b, c],
        breaking: [b, d],
        topProbability: [c, d, e],
        topToday: [d],
      },
      5,
    );
    expect(boards.map((board) => board.key)).toEqual([
      "hotPicks",
      "breaking",
      "topProbability",
    ]);
    expect(boards[0]!.events.map((x) => x.id)).toEqual([b.id, c.id]);
    expect(boards[1]!.events.map((x) => x.id)).toEqual([d.id]);
    // 今日热门只有 d，已被"突发"占用 → 整榜消失
    expect(boards[2]!.events.map((x) => x.id)).toEqual([e.id]);
  });

  it("caps every board at the limit", () => {
    const boards = buildRankBoards(
      {
        heroIds: new Set(),
        hotPicks: EVENTS,
        breaking: [],
        topProbability: [],
        topToday: [],
      },
      2,
    );
    expect(boards).toHaveLength(1);
    expect(boards[0]!.events).toHaveLength(2);
  });
});
