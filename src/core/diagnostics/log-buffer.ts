import { now } from "../time/clock";
import { findSecrets, redactSecrets } from "../security/secret-scan";

/**
 * 诊断日志的环形缓冲（设计 diagnostic-report-2026-09-14 §4.1）。
 *
 * 用户在「关于 > 版本信息」按下「上报问题」时，这里的内容会被打成 NDJSON 传给服务端。
 * 也就是说**这是一个外泄出口**，所以三件事是硬约束：
 *
 * 1. 只在内存里（崩溃快照是唯一例外，见 crash-snapshot.ts）；
 * 2. 写入口的签名不收任意值——`message` 只收字符串、`fields` 只收标量。
 *    收 `unknown` 或对象就等于允许 `JSON.stringify(整个响应)` 进来，
 *    而那里面有 token、地址、余额；
 * 3. 每一条都过 `redactSecrets`。这是**最后一道网**，不是防线：防线是
 *    「日志里根本不该出现密钥材料」（模块边界 lint + 抛出点不拼输入）。
 */

export type LogLevel = "info" | "warn" | "error";

/** 模块标签。刻意是联合类型而不是 string：新增来源要在这里登记一次。 */
export type LogTag = "net" | "config" | "ota" | "wallet" | "nav" | "crash";

/** 字段值只能是标量——对象会把"顺手记一下"变成"把整个响应体记下来"。 */
export type LogField = string | number | boolean;

export type LogEntry = {
  at: number;
  level: LogLevel;
  tag: LogTag;
  message: string;
  fields?: Record<string, LogField>;
};

export const LOG_CAPACITY = 500;
export const MAX_MESSAGE_LENGTH = 512;
export const MAX_FIELDS = 8;
export const MAX_FIELD_LENGTH = 128;

const buffer: (LogEntry | undefined)[] = new Array<LogEntry | undefined>(
  LOG_CAPACITY,
);
let writeIndex = 0;
let written = 0;
let leaks = 0;

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

/**
 * 出口扫描命中意味着**前面几道结构性隔离漏了**，不是"成功挡住了"。
 *
 * 这里刻意不抛：`logEvent` 抛异常会让一个诊断设施变成崩溃来源，而它被调用的地方
 * 恰恰是已经出错的路径。改为计数 + 开发构建下大声报错，由测试断言计数为 0。
 */
function scrub(text: string): string {
  if (findSecrets(text).length === 0) return text;
  leaks += 1;
  if (__DEV__)
    console.error(
      "[log-buffer] key material reached the diagnostics exit; a structural guard is missing",
    );
  return redactSecrets(text);
}

function scrubFields(
  fields: Record<string, LogField> | undefined,
): Record<string, LogField> | undefined {
  if (!fields) return undefined;
  const result: Record<string, LogField> = {};
  for (const [key, value] of Object.entries(fields).slice(0, MAX_FIELDS))
    result[key] =
      typeof value === "string"
        ? truncate(scrub(value), MAX_FIELD_LENGTH)
        : value;
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * 唯一的写入口。永远不抛：诊断设施不能成为崩溃来源，它被调用的地方通常已经在出错了。
 */
export function logEvent(
  level: LogLevel,
  tag: LogTag,
  message: string,
  fields?: Record<string, LogField>,
): void {
  try {
    const entry: LogEntry = {
      at: now(),
      level,
      tag,
      message: truncate(scrub(message), MAX_MESSAGE_LENGTH),
    };
    const safeFields = scrubFields(fields);
    if (safeFields) entry.fields = safeFields;
    buffer[writeIndex] = entry;
    writeIndex = (writeIndex + 1) % LOG_CAPACITY;
    written += 1;
  } catch {
    // 记日志失败不能反过来影响业务
  }
}

/** 只读快照，按时间从旧到新。 */
export function snapshotLogs(): LogEntry[] {
  const entries: LogEntry[] = [];
  const total = Math.min(written, LOG_CAPACITY);
  const start = (writeIndex - total + LOG_CAPACITY) % LOG_CAPACITY;
  for (let offset = 0; offset < total; offset += 1) {
    const entry = buffer[(start + offset) % LOG_CAPACITY];
    if (entry) entries.push(entry);
  }
  return entries;
}

/** 缓冲里最新的 `count` 条（崩溃快照用；见 §4.5 的 tail）。 */
export function tailLogs(count: number): LogEntry[] {
  const entries = snapshotLogs();
  return count >= entries.length
    ? entries
    : entries.slice(entries.length - count);
}

export function clearLogs(): void {
  buffer.fill(undefined);
  writeIndex = 0;
  written = 0;
}

/**
 * 出口扫描的累计命中数。测试断言它为 0——命中即缺陷（设计 §3.5）。
 */
export function secretLeakCount(): number {
  return leaks;
}

export function resetSecretLeakCount(): void {
  leaks = 0;
}

/** 一条日志的 NDJSON 行（上传格式，设计 §4.3）。 */
export function toNdjsonLine(entry: LogEntry): string {
  return JSON.stringify(entry);
}

export function toNdjson(entries: LogEntry[]): string {
  return entries.map(toNdjsonLine).join("\n");
}
