import * as Crypto from "expo-crypto";
import { now } from "../time/clock";
import {
  AUTO_REPORTS_PER_DAY,
  autoReportsToday,
  isCrashLoop,
  readCrashGates,
  recordCrashSent,
  recordLaunchHealthy,
  recordLaunchStart,
  sentRecently,
  suspendAutoReports,
  type CrashGates,
} from "./crash-gates";
import {
  clearCrashSnapshot,
  readCrashSnapshot,
  type CrashSnapshot,
} from "./crash-snapshot";
import {
  prepareReport,
  submitReport,
  type PreparedReport,
  type ReportOutcome,
} from "./report-service";

/**
 * 崩溃自动上报的编排（设计 diagnostic-report-2026-09-14 §4.6）。
 *
 * **上报发生在下次启动，不在崩溃现场**：进程正在死，请求本来就不可靠，而且那正是崩溃
 * 循环把一次崩溃放大成一串上传的地方。五道闸全过才自动发，否则要么留给用户手动上报，
 * 要么丢弃：
 *
 * | 闸 | 没过时 |
 * | --- | --- |
 * | 1. 远程开关 features.crashAutoReport | 留给人工 |
 * | 2. 用户开关 | 留给人工 |
 * | 3. 崩溃循环（之前连续 3 次启动都没活过 60 秒） | 熔断 + 丢弃 |
 * | 4. 同指纹 24 小时内发过 | 丢弃 |
 * | 5. 当天已自动发满 3 条 | 丢弃 |
 *
 * 已经处于熔断中（不是这次刚检测到循环）时，快照留给人工：熔断的约定是"直到用户手动
 * 操作一次"，而手动上报这一条恰好就是那一次操作。
 */

export const LAUNCH_HEALTHY_AFTER_MS = 60_000;

/** error.name 与栈顶帧名的哈希前 16 位：同一个崩溃在不同设备上得到同一个指纹，管理端按它聚合。 */
export async function crashFingerprint(
  errorName: string,
  frame: string,
): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${errorName}|${frame}`,
  );
  return digest.slice(0, 16);
}

let launch: { at: number; previous: Promise<CrashGates["launches"]> } | null =
  null;

/**
 * 记下这次启动，并在活过 60 秒后标记为健康。App 模块顶层调用一次；热重载重复调用无副作用。
 */
export function beginLaunch(): void {
  if (launch) return;
  const at = now();
  launch = { at, previous: recordLaunchStart(at) };
  setTimeout(() => void recordLaunchHealthy(at), LAUNCH_HEALTHY_AFTER_MS);
}

/** 仅测试用。 */
export function resetLaunchForTest(): void {
  launch = null;
}

export type PendingCrashOutcome =
  "none" | "sent" | "prompt" | "discarded" | "suspended" | "retry";

export async function processPendingCrash(input: {
  remoteEnabled: boolean;
  userEnabled: boolean;
  locale: string;
}): Promise<PendingCrashOutcome> {
  const snapshot = await readCrashSnapshot();
  if (!snapshot) return "none";
  if (!input.remoteEnabled || !input.userEnabled) return "prompt";

  const previous = launch ? await launch.previous : [];
  if (isCrashLoop(previous)) {
    await suspendAutoReports();
    await clearCrashSnapshot();
    return "suspended";
  }
  const gates = await readCrashGates();
  if (gates.suspended) return "prompt";

  const fingerprint = await crashFingerprint(
    snapshot.errorName,
    snapshot.frame,
  );
  const at = now();
  if (
    sentRecently(gates, fingerprint, at) ||
    autoReportsToday(gates, at) >= AUTO_REPORTS_PER_DAY
  ) {
    await clearCrashSnapshot();
    return "discarded";
  }

  const outcome = await submitReport(
    crashReportFrom(snapshot, fingerprint, "crash_auto", input.locale),
  );
  if (outcome.status === "submitted") {
    await recordCrashSent({ fingerprint, at, automatic: true });
    await clearCrashSnapshot();
    return "sent";
  }
  // 服务端明确说不收：别留着下次再撞。网络、凭证这类可能自己好的，留到下次启动
  if (outcome.reason === "quota" || outcome.reason === "disabled") {
    await clearCrashSnapshot();
    return "discarded";
  }
  return "retry";
}

function crashReportFrom(
  snapshot: CrashSnapshot,
  fingerprint: string,
  kind: "crash" | "crash_auto",
  locale: string,
): PreparedReport {
  return prepareReport({
    kind,
    locale,
    crash: { fingerprint, errorName: snapshot.errorName },
    entries: snapshot.tail,
    occurredAt: snapshot.at,
    app: snapshot.app,
  });
}

/** 设置页「上次异常退出，是否上报」：把快照变成一份等用户确认的报告。 */
export async function preparePendingCrashReport(
  locale: string,
): Promise<{ prepared: PreparedReport; fingerprint: string } | null> {
  const snapshot = await readCrashSnapshot();
  if (!snapshot) return null;
  const fingerprint = await crashFingerprint(
    snapshot.errorName,
    snapshot.frame,
  );
  return {
    prepared: crashReportFrom(snapshot, fingerprint, "crash", locale),
    fingerprint,
  };
}

/** 用户手动发出了一份崩溃报告：删快照、记指纹（下次启动不会再自动发同一个）、解除熔断。 */
export async function completeManualCrashReport(
  prepared: PreparedReport,
  outcome: ReportOutcome,
): Promise<void> {
  if (outcome.status !== "submitted" || !prepared.crash) return;
  await recordCrashSent({
    fingerprint: prepared.crash.fingerprint,
    at: now(),
    automatic: false,
  });
  await clearCrashSnapshot();
}
