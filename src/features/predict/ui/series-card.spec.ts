import type { SeriesPeriod } from "../model/predict";
import { isPeriodLive, pickCurrentPeriod } from "./series-card";

function period(id: string, start: string, end: string): SeriesPeriod {
  return {
    id,
    seriesId: "s",
    eventId: `ev-${id}`,
    marketId: `m-${id}`,
    windowStart: start,
    windowEnd: end,
    stage: "published",
    priceToBeat: null,
    finalPrice: null,
    result: null,
  };
}

const p1 = period("1", "2026-08-30T11:50:00Z", "2026-08-30T11:55:00Z");
const p2 = period("2", "2026-08-30T11:55:00Z", "2026-08-30T12:00:00Z");
const p3 = period("3", "2026-08-30T12:00:00Z", "2026-08-30T12:05:00Z");
const at = (iso: string) => new Date(iso).getTime();

describe("series periods", () => {
  it("picks the window containing now, else the next one, else the latest", () => {
    // 乱序输入也按开始时间挑
    const periods = [p3, p1, p2];
    expect(pickCurrentPeriod(periods, at("2026-08-30T11:57:00Z"))?.id).toBe(
      "2",
    );
    expect(pickCurrentPeriod(periods, at("2026-08-30T12:00:00Z"))?.id).toBe(
      "3",
    );
    expect(pickCurrentPeriod(periods, at("2026-08-30T11:00:00Z"))?.id).toBe(
      "1",
    );
    expect(pickCurrentPeriod(periods, at("2026-08-30T13:00:00Z"))?.id).toBe(
      "3",
    );
    expect(pickCurrentPeriod([], at("2026-08-30T13:00:00Z"))).toBeNull();
  });

  it("treats the window as live only between start (inclusive) and end (exclusive)", () => {
    expect(isPeriodLive(p2, at("2026-08-30T11:55:00Z"))).toBe(true);
    expect(isPeriodLive(p2, at("2026-08-30T11:59:59Z"))).toBe(true);
    expect(isPeriodLive(p2, at("2026-08-30T12:00:00Z"))).toBe(false);
    expect(isPeriodLive(p2, at("2026-08-30T11:54:59Z"))).toBe(false);
  });
});
