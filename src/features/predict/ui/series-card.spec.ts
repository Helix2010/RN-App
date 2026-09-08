import type { SeriesPeriod } from "../model/predict";
import {
  isPeriodLive,
  periodCountdown,
  periodPhase,
  periodResultLabel,
  pickCurrentPeriod,
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
