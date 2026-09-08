import type { SeriesPeriod } from "../model/predict";
import {
  isPeriodLive,
  isSeriesPosition,
  nextPeriodAfter,
  periodCountdown,
  periodPhase,
  periodResultLabel,
  pickCurrentPeriod,
  positionWindowLabel,
  recurrenceToMs,
  rolloverDecision,
  subscribeTick,
} from "./series-card";

const t = (key: string) => key;

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
    resolutionSource: null,
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

  it("labels the window phase and countdown, and reports failed / held stages", () => {
    expect(periodPhase(p2, at("2026-08-30T11:57:00Z"))).toBe("live");
    expect(periodPhase(p2, at("2026-08-30T11:50:00Z"))).toBe("upcoming");
    expect(periodPhase(p2, at("2026-08-30T12:30:00Z"))).toBe("ended");
    expect(periodCountdown(p2, at("2026-08-30T11:57:00Z"), t)).toContain(
      "predict.series.endsIn",
    );
    expect(periodCountdown(p2, at("2026-08-30T11:50:00Z"), t)).toContain(
      "predict.series.startsIn",
    );
    expect(periodCountdown(p2, at("2026-08-30T12:30:00Z"), t)).toBe(
      "predict.series.ended",
    );
    expect(periodResultLabel({ ...p1, result: "up" }, t)).toBe(
      "predict.series.up",
    );
    expect(periodResultLabel({ ...p1, result: "down" }, t)).toBe(
      "predict.series.down",
    );
    expect(periodResultLabel({ ...p1, stage: "failed" }, t)).toBe(
      "predict.series.stage.failed",
    );
    expect(periodResultLabel({ ...p1, stage: "held" }, t)).toBe(
      "predict.series.stage.held",
    );
    expect(periodResultLabel({ ...p1, stage: "closing" }, t)).toBe(
      "predict.series.pending",
    );
  });

  it("shares one interval between every ticking subscriber and stops it with the last one", () => {
    jest.useFakeTimers();
    const before = jest.getTimerCount();
    const a = jest.fn();
    const b = jest.fn();
    const stopA = subscribeTick(a);
    const stopB = subscribeTick(b);
    // 两个订阅者只多出一个秒表
    expect(jest.getTimerCount()).toBe(before + 1);
    jest.advanceTimersByTime(1_000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    stopA();
    jest.advanceTimersByTime(1_000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
    stopB();
    expect(jest.getTimerCount()).toBe(before);
    jest.advanceTimersByTime(1_000);
    expect(b).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});

describe("series period helpers", () => {
  it("parses platform recurrence text into milliseconds and refuses what it cannot read", () => {
    expect(recurrenceToMs("5m")).toBe(300_000);
    expect(recurrenceToMs("15m")).toBe(900_000);
    expect(recurrenceToMs("1h")).toBe(3_600_000);
    expect(recurrenceToMs("1d")).toBe(86_400_000);
    expect(recurrenceToMs("weekly")).toBeNull();
    expect(recurrenceToMs(null)).toBeNull();
  });

  it("treats a position as periodic only when both series fields are present", () => {
    expect(
      isSeriesPosition({ seriesSlug: "btc-updown-5m", seriesRecurrence: "5m" }),
    ).toBe(true);
    expect(
      isSeriesPosition({ seriesSlug: "btc-updown-5m", seriesRecurrence: null }),
    ).toBe(false);
    expect(isSeriesPosition({ seriesSlug: " ", seriesRecurrence: "5m" })).toBe(
      false,
    );
  });

  it("derives the position's window from its close time and recurrence", () => {
    const label = positionWindowLabel(
      { endsAt: "2026-08-30T12:00:00Z", seriesRecurrence: "5m" },
      "en-US",
    );
    expect(label).toMatch(/^\d{2}:\d{2} – \d{2}:\d{2}$/);
    expect(
      positionWindowLabel({ endsAt: null, seriesRecurrence: "5m" }, "en-US"),
    ).toBeNull();
    expect(
      positionWindowLabel(
        { endsAt: "2026-08-30T12:00:00Z", seriesRecurrence: "x" },
        "en-US",
      ),
    ).toBeNull();
  });

  it("finds the window that starts right after the current one", () => {
    expect(nextPeriodAfter([p3, p1, p2], p1)?.id).toBe("2");
    expect(nextPeriodAfter([p1, p2], p2)).toBeNull();
    expect(nextPeriodAfter([p1, p2], null)).toBeNull();
  });

  it("stays on an ended window only when following and holding a position in it", () => {
    const held = new Set(["m-1"]);
    expect(
      rolloverDecision({
        following: true,
        endedMarketId: "m-1",
        heldMarketIds: held,
      }),
    ).toBe("stay");
    expect(
      rolloverDecision({
        following: true,
        endedMarketId: "m-2",
        heldMarketIds: held,
      }),
    ).toBe("switch");
    expect(
      rolloverDecision({
        following: true,
        endedMarketId: null,
        heldMarketIds: held,
      }),
    ).toBe("switch");
    expect(
      rolloverDecision({
        following: false,
        endedMarketId: "m-1",
        heldMarketIds: held,
      }),
    ).toBe("none");
  });
});
