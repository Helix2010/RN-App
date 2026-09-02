import {
  displayPrice,
  fetchEvents,
  gammaMarketSchema,
  translationOf,
} from "./gamma";
import { setPlatformFetch } from "./tenant-client";

const service = {
  domain: "predict.prax1s.xyz",
  scopeId: `0x${"fb".repeat(32)}`,
  chain: "op-sepolia" as const,
};

afterEach(() => setPlatformFetch(null));

describe("translationOf", () => {
  it("keeps the platform's original text as default and normalises locale keys", () => {
    expect(
      translationOf('{"zh_CN": "标题", "en": "Title"}', "Title (raw)"),
    ).toEqual({ default: "Title (raw)", "zh-CN": "标题", en: "Title" });
  });

  it("ignores a non-JSON translation and empty values", () => {
    expect(translationOf("not json", "Raw")).toEqual({ default: "Raw" });
    expect(translationOf('{"zh": "  "}', null)).toEqual({});
  });
});

describe("gammaMarketSchema", () => {
  it("accepts outcomes / clobTokenIds as arrays or JSON strings and numbers as strings", () => {
    const parsed = gammaMarketSchema.parse({
      id: 7,
      conditionId: `0x${"11".repeat(32)}`,
      question: "Will it rain?",
      outcomes: '["Yes", "No"]',
      outcomePrices: ["0.6", "0.4"],
      clobTokenIds: '["111", "222"]',
      volume: "1234.5",
      bestBid: "0.58",
      bestAsk: 0.62,
    });
    expect(parsed.id).toBe("7");
    expect(parsed.outcomes).toEqual(["Yes", "No"]);
    expect(parsed.clobTokenIds).toEqual(["111", "222"]);
    expect(parsed.volume).toBe(1234.5);
    expect(displayPrice(parsed)).toBeCloseTo(0.6);
  });

  it("derives the display price like the web client: mid → ask → bid → last trade → null", () => {
    const base = gammaMarketSchema.parse({
      id: "1",
      conditionId: "0xabc",
      outcomes: [],
      outcomePrices: [],
      clobTokenIds: [],
    });
    expect(displayPrice({ ...base, bestAsk: 0.7 })).toBe(0.7);
    expect(displayPrice({ ...base, bestBid: 0.3 })).toBe(0.3);
    expect(displayPrice({ ...base, lastTradePrice: 0.55 })).toBe(0.55);
    expect(displayPrice(base)).toBeNull();
    // 超出 0–1 的值不是概率，不采用
    expect(displayPrice({ ...base, bestBid: 1.5 })).toBeNull();
  });
});

describe("fetchEvents", () => {
  it("asks gamma the way the web client does: active, not closed, recurring excluded, sort direction by field", async () => {
    const urls: string[] = [];
    setPlatformFetch(async (input) => {
      urls.push(String(input));
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await fetchEvents(service, { limit: 20, offset: 40, tagId: "3" });
    await fetchEvents(service, {
      limit: 5,
      offset: 0,
      order: "end_date_iso",
      featured: true,
    });
    const first = new URL(urls[0] ?? "");
    expect(first.host).toBe("gamma-api.predict.prax1s.xyz");
    expect(first.pathname).toBe("/events");
    expect(Object.fromEntries(first.searchParams)).toEqual({
      active: "true",
      closed: "false",
      limit: "20",
      offset: "40",
      order: "volume",
      ascending: "false",
      tag_id: "3",
      exclude_tag_slug: "recurring",
    });
    const second = new URL(urls[1] ?? "");
    expect(second.searchParams.get("order")).toBe("end_date_iso");
    expect(second.searchParams.get("ascending")).toBe("true");
    expect(second.searchParams.get("featured")).toBe("true");
  });
});
