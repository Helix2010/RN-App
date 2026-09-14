import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { tailLogs, type LogEntry } from "./log-buffer";

/**
 * 崩溃快照（设计 diagnostic-report-2026-09-14 §4.5）：崩溃那一刻的现场，留给下次启动上报。
 *
 * 只存四样：错误类名、栈顶的函数/组件**名字**、崩溃时的 App 版本、日志缓冲的尾巴。
 * - 不单独存错误消息：崩溃那条日志已经在尾巴里，并且过了出口扫描；
 * - 栈帧只取名字：帧里带文件路径，开发构建下是含用户名的绝对路径；
 * - 版本必须在崩溃时记：重启时可能恰好应用了一个新 OTA，下次启动读到的已经不是出事的那一版。
 *
 * 只保留一条，新的覆盖旧的；上报成功立即删除。整体不超过 64 KB，超了先裁尾巴里最旧的。
 */

const KEY = "foundation.diagnostics.pending-crash.v1";
export const CRASH_TAIL_ENTRIES = 100;
export const CRASH_SNAPSHOT_MAX_BYTES = 64 * 1024;

const entrySchema = z.object({
  at: z.number(),
  level: z.enum(["info", "warn", "error"]),
  tag: z.enum(["net", "config", "ota", "wallet", "nav", "crash"]),
  message: z.string(),
  fields: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional(),
});

const snapshotSchema = z.object({
  version: z.literal(1),
  at: z.number(),
  source: z.enum(["render", "global"]),
  errorName: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,79}$/),
  frame: z.string().max(80),
  app: z.object({
    version: z.string(),
    buildNumber: z.string(),
    runtimeVersion: z.string(),
    otaChannel: z.string(),
    distributionChannel: z.string(),
    launchSource: z.enum(["embedded", "ota"]),
    runningUpdateId: z.string().optional(),
  }),
  tail: z.array(entrySchema).max(CRASH_TAIL_ENTRIES),
});

export type CrashSnapshot = z.infer<typeof snapshotSchema>;
export type CrashApp = CrashSnapshot["app"];

/** 类名也验形状：`error.name` 是可写属性，谁都能往里塞一句话 */
export function crashErrorName(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  return /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(name) ? name : "UnknownError";
}

/**
 * 栈顶的函数名或组件名。认 React 19 的 "at X (…)"、旧版 componentStack 的 "in X"、
 * Hermes 的 "at X (address at …)"。取不到就是 "unknown"——指纹照样能算，只是聚合粗一些。
 */
export function topFrameName(stack: string | undefined): string {
  const match = stack?.match(/(?:^|\n)\s*(?:at|in) ([A-Za-z0-9_$.<>]{1,80})/);
  return match?.[1] ?? "unknown";
}

export function buildCrashSnapshot(input: {
  at: number;
  source: CrashSnapshot["source"];
  error: unknown;
  stack: string | undefined;
  app: CrashApp;
}): CrashSnapshot {
  const snapshot: CrashSnapshot = {
    version: 1,
    at: input.at,
    source: input.source,
    errorName: crashErrorName(input.error),
    frame: topFrameName(input.stack),
    app: input.app,
    tail: tailLogs(CRASH_TAIL_ENTRIES) as LogEntry[],
  };
  while (
    snapshot.tail.length > 0 &&
    JSON.stringify(snapshot).length > CRASH_SNAPSHOT_MAX_BYTES
  )
    snapshot.tail.shift();
  return snapshot;
}

/** 尽力而为：致命错误时进程可能在写完之前就没了，这是已知限制（设计 §4.5）。 */
export async function writeCrashSnapshot(
  snapshot: CrashSnapshot,
): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    // 写不进去就算了，崩溃处理不能再抛
  }
}

/** 读不出来或形状不对就删掉：一份坏快照留着只会每次启动都读失败一遍。 */
export async function readCrashSnapshot(): Promise<CrashSnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = snapshotSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // 落到下面删除
  }
  await clearCrashSnapshot();
  return null;
}

export async function clearCrashSnapshot(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // 删不掉下次再删；上报侧有指纹去重兜着，不会重复发
  }
}
