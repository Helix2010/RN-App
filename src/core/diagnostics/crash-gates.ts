import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";

/**
 * 崩溃自动上报的闸门状态（设计 diagnostic-report-2026-09-14 §4.6）。一条记录装四样：
 * 最近几次启动是否"活过 60 秒"、已经发过的崩溃指纹、当天自动上报的条数、熔断标记。
 *
 * 放在一条记录里、并且所有读写排成队：启动标记、健康标记、上报结果三处会在同一次启动里
 * 先后写它，各读各写就会互相覆盖。
 */

const KEY = "foundation.diagnostics.crash-gates.v1";
/** 当前这次 + 之前 3 次 */
const LAUNCH_HISTORY = 4;
const SENT_HISTORY = 20;
export const CRASH_LOOP_LAUNCHES = 3;
export const AUTO_REPORTS_PER_DAY = 3;
export const FINGERPRINT_DEDUPE_MS = 24 * 60 * 60 * 1000;

const gatesSchema = z.object({
  version: z.literal(1),
  launches: z.array(z.object({ at: z.number(), healthy: z.boolean() })),
  sent: z.array(z.object({ fingerprint: z.string(), at: z.number() })),
  autoDay: z.string(),
  autoCount: z.number().int().nonnegative(),
  suspended: z.boolean(),
});

export type CrashGates = z.infer<typeof gatesSchema>;

const EMPTY: CrashGates = {
  version: 1,
  launches: [],
  sent: [],
  autoDay: "",
  autoCount: 0,
  suspended: false,
};

let queue: Promise<unknown> = Promise.resolve();

async function read(): Promise<CrashGates> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = gatesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY;
  } catch {
    return EMPTY;
  }
}

/** 串行地读—改—写。失败时返回读到的旧值：闸门状态丢一次，最坏是少发或多等一次，不是崩溃。 */
export function updateCrashGates(
  change: (gates: CrashGates) => CrashGates,
): Promise<CrashGates> {
  const next = queue.then(async () => {
    const current = await read();
    const updated = change(current);
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(updated));
    } catch {
      return current;
    }
    return updated;
  });
  queue = next.catch(() => undefined);
  return next;
}

export function readCrashGates(): Promise<CrashGates> {
  return updateCrashGates((gates) => gates);
}

export function dayOf(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** 记下这次启动（先记成不健康），返回之前那几次。 */
export async function recordLaunchStart(
  at: number,
): Promise<CrashGates["launches"]> {
  let previous: CrashGates["launches"] = [];
  await updateCrashGates((gates) => {
    previous = gates.launches;
    return {
      ...gates,
      launches: [...gates.launches, { at, healthy: false }].slice(
        -LAUNCH_HISTORY,
      ),
    };
  });
  return previous;
}

/** 这次启动活过了 60 秒：标记为健康。 */
export function recordLaunchHealthy(at: number): Promise<CrashGates> {
  return updateCrashGates((gates) => ({
    ...gates,
    launches: gates.launches.map((launch) =>
      launch.at === at ? { ...launch, healthy: true } : launch,
    ),
  }));
}

/** 之前连续 3 次启动都没活过 60 秒，就当作崩溃循环。 */
export function isCrashLoop(previous: CrashGates["launches"]): boolean {
  const recent = previous.slice(-CRASH_LOOP_LAUNCHES);
  return (
    recent.length === CRASH_LOOP_LAUNCHES &&
    recent.every((launch) => !launch.healthy)
  );
}

export function sentRecently(
  gates: CrashGates,
  fingerprint: string,
  now: number,
): boolean {
  return gates.sent.some(
    (item) =>
      item.fingerprint === fingerprint && now - item.at < FINGERPRINT_DEDUPE_MS,
  );
}

export function autoReportsToday(gates: CrashGates, now: number): number {
  return gates.autoDay === dayOf(now) ? gates.autoCount : 0;
}

/**
 * 一次崩溃报告发出去了。自动的计入当日条数；任何一次上报成功都解除熔断——
 * 熔断的约定是"停止自动上报，直到用户手动操作一次"（设计 §4.6 第 5 条）。
 */
export function recordCrashSent(input: {
  fingerprint: string;
  at: number;
  automatic: boolean;
}): Promise<CrashGates> {
  return updateCrashGates((gates) => {
    const today = dayOf(input.at);
    const count = gates.autoDay === today ? gates.autoCount : 0;
    return {
      ...gates,
      sent: [
        ...gates.sent,
        { fingerprint: input.fingerprint, at: input.at },
      ].slice(-SENT_HISTORY),
      autoDay: today,
      autoCount: input.automatic ? count + 1 : count,
      suspended: input.automatic ? gates.suspended : false,
    };
  });
}

export function suspendAutoReports(): Promise<CrashGates> {
  return updateCrashGates((gates) => ({ ...gates, suspended: true }));
}

/** 用户手动上报了一次（任何类型）：解除熔断。 */
export function resumeAutoReports(): Promise<CrashGates> {
  return updateCrashGates((gates) => ({ ...gates, suspended: false }));
}
