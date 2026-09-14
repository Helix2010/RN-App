import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AUTO_REPORTS_PER_DAY,
  FINGERPRINT_DEDUPE_MS,
  autoReportsToday,
  isCrashLoop,
  readCrashGates,
  recordCrashSent,
  recordLaunchHealthy,
  recordLaunchStart,
  resumeAutoReports,
  sentRecently,
  suspendAutoReports,
} from "./crash-gates";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 14, 8);

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("launch history", () => {
  it("returns the launches before this one and keeps a short history", async () => {
    for (let i = 0; i < 6; i += 1) await recordLaunchStart(T0 + i);
    const previous = await recordLaunchStart(T0 + 6);
    // 存 4 条（当前 + 之前 3 次），所以记下第 7 次之前读到的是第 3～6 次
    expect(previous.map((launch) => launch.at)).toEqual([
      T0 + 2,
      T0 + 3,
      T0 + 4,
      T0 + 5,
    ]);
    expect((await readCrashGates()).launches).toHaveLength(4);
  });

  it("marks only the matching launch healthy", async () => {
    await recordLaunchStart(T0);
    await recordLaunchStart(T0 + 1);
    await recordLaunchHealthy(T0);
    expect((await readCrashGates()).launches).toEqual([
      { at: T0, healthy: true },
      { at: T0 + 1, healthy: false },
    ]);
  });

  it("calls three unhealthy launches in a row a crash loop, and nothing less", () => {
    const bad = { at: 1, healthy: false };
    const good = { at: 1, healthy: true };
    expect(isCrashLoop([bad, bad, bad])).toBe(true);
    expect(isCrashLoop([good, bad, bad, bad])).toBe(true);
    expect(isCrashLoop([bad, bad])).toBe(false);
    expect(isCrashLoop([bad, good, bad])).toBe(false);
  });

  // 启动标记、健康标记、上报结果会在同一次启动里先后写同一条记录
  it("does not lose a write when updates overlap", async () => {
    await Promise.all([
      recordLaunchStart(T0),
      recordCrashSent({ fingerprint: "a", at: T0, automatic: true }),
      suspendAutoReports(),
    ]);
    const gates = await readCrashGates();
    expect(gates.launches).toHaveLength(1);
    expect(gates.sent).toHaveLength(1);
    expect(gates.suspended).toBe(true);
  });
});

describe("sent crashes", () => {
  it("dedupes a fingerprint for 24 hours", async () => {
    const gates = await recordCrashSent({
      fingerprint: "a1",
      at: T0,
      automatic: true,
    });
    expect(sentRecently(gates, "a1", T0 + FINGERPRINT_DEDUPE_MS - 1)).toBe(
      true,
    );
    expect(sentRecently(gates, "a1", T0 + FINGERPRINT_DEDUPE_MS)).toBe(false);
    expect(sentRecently(gates, "b2", T0)).toBe(false);
  });

  it("counts automatic reports per day and starts over the next day", async () => {
    let gates = await readCrashGates();
    for (let i = 0; i < AUTO_REPORTS_PER_DAY; i += 1)
      gates = await recordCrashSent({
        fingerprint: `f${i}`,
        at: T0 + i,
        automatic: true,
      });
    await recordCrashSent({
      fingerprint: "manual",
      at: T0 + 10,
      automatic: false,
    });
    gates = await readCrashGates();
    expect(autoReportsToday(gates, T0 + 20)).toBe(AUTO_REPORTS_PER_DAY);
    expect(autoReportsToday(gates, T0 + DAY)).toBe(0);
  });

  it("lifts the suspension only when a person sends a report", async () => {
    await suspendAutoReports();
    await recordCrashSent({ fingerprint: "auto", at: T0, automatic: true });
    expect((await readCrashGates()).suspended).toBe(true);
    await recordCrashSent({ fingerprint: "manual", at: T0, automatic: false });
    expect((await readCrashGates()).suspended).toBe(false);
    await suspendAutoReports();
    await resumeAutoReports();
    expect((await readCrashGates()).suspended).toBe(false);
  });
});
