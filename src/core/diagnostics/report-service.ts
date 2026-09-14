import * as Crypto from "expo-crypto";
import { z } from "zod";
import {
  deviceDescriptor,
  ensureInstallationAuthorization,
  runningBundle,
} from "../device/installation-service";
import { apiClient, appRuntime } from "../network/api-client";
import { AppError } from "../network/app-error";
import { now } from "../time/clock";
import { snapshotLogs, toNdjson, type LogEntry } from "./log-buffer";

/**
 * 一键上报（设计 diagnostic-report-2026-09-14 §4.4）。
 *
 * 两步：先用 `prepareReport` 把要发的东西一次性定下来，界面把它原样摊给用户看；
 * 用户确认后 `submitReport` 发送**同一个对象**。所以"给用户看的"和"真正发出去的"
 * 不可能不一致——中间不会再读一次日志缓冲。
 *
 * 身份不在这里：租户、安装实例、账号都由服务端从域名、安装凭证、会话解析。
 */

export type ReportKind = "user" | "crash" | "crash_auto";

export type CrashIdentity = { fingerprint: string; errorName: string };

export type PreparedReport = Readonly<{
  reportId: string;
  kind: ReportKind;
  occurredAt: string;
  crash?: CrashIdentity;
  app: Readonly<{
    version: string;
    buildNumber: string;
    runtimeVersion: string;
    otaChannel: string;
    distributionChannel: string;
    launchSource: "embedded" | "ota";
    runningUpdateId?: string;
    locale: string;
    osVersion: string;
    deviceClass: string;
  }>;
  context: Readonly<{ screen?: string; lastRequestId?: string }>;
  entries: readonly LogEntry[];
}>;

export type ReportFailure =
  "throttled" | "disabled" | "quota" | "credential" | "network" | "unavailable";

export type ReportOutcome =
  | { status: "submitted"; reference: string; logStored: boolean }
  | { status: "failed"; reason: ReportFailure };

/** 两次手动上报之间至少隔这么久（设计 §4.4）；自动上报有自己的闸，不走这一条。 */
export const MANUAL_REPORT_INTERVAL_MS = 60_000;

let lastManualSubmitAt: number | null = null;

/** 仅测试用。 */
export function resetReportThrottleForTest(): void {
  lastManualSubmitAt = null;
}

/** 现场：最后一个页面、最后一次失败请求的 requestId。都从日志缓冲里取，不另外记状态。 */
function contextOf(entries: readonly LogEntry[]): PreparedReport["context"] {
  let screen: string | undefined;
  let lastRequestId: string | undefined;
  for (const entry of entries) {
    const name = entry.fields?.name;
    const requestId = entry.fields?.requestId;
    if (entry.tag === "nav" && typeof name === "string") screen = name;
    if (entry.tag === "net" && typeof requestId === "string")
      lastRequestId = requestId;
  }
  return {
    ...(screen ? { screen } : {}),
    ...(lastRequestId ? { lastRequestId } : {}),
  };
}

/** 此刻在跑的这一版。崩溃快照在崩溃时记它，手动上报在准备时取它。 */
export function currentBuild(): NonNullable<
  Parameters<typeof prepareReport>[0]["app"]
> {
  const bundle = runningBundle();
  return {
    version: appRuntime.version,
    buildNumber: appRuntime.buildNumber,
    runtimeVersion: appRuntime.runtimeVersion,
    otaChannel: appRuntime.otaChannel,
    distributionChannel: appRuntime.distributionChannel,
    launchSource: bundle.launchSource,
    ...(bundle.runningUpdateId
      ? { runningUpdateId: bundle.runningUpdateId }
      : {}),
  };
}

export function prepareReport(input: {
  kind: ReportKind;
  locale: string;
  crash?: CrashIdentity;
  /** 崩溃快照带着崩溃那一刻的日志尾巴；手动上报取当前缓冲 */
  entries?: readonly LogEntry[];
  occurredAt?: number;
  /**
   * 崩溃时的版本。下次启动才上报时必须用它：重启可能恰好应用了新 OTA，
   * 此刻在跑的已经不是出事的那一版
   */
  app?: {
    version: string;
    buildNumber: string;
    runtimeVersion: string;
    otaChannel: string;
    distributionChannel: string;
    launchSource: "embedded" | "ota";
    runningUpdateId?: string;
  };
}): PreparedReport {
  const entries = input.entries ?? snapshotLogs();
  const build = input.app ?? currentBuild();
  return {
    reportId: `rpt_${Crypto.randomUUID().replaceAll("-", "")}`,
    kind: input.kind,
    occurredAt: new Date(input.occurredAt ?? now()).toISOString(),
    ...(input.crash ? { crash: input.crash } : {}),
    app: { ...build, locale: input.locale, ...deviceDescriptor() },
    context: contextOf(entries),
    entries,
  };
}

const createdSchema = z.object({
  reportId: z.string(),
  reference: z.string().regex(/^[0-9A-Z]{8}$/),
  logUpload: z.object({ required: z.boolean() }),
});
const logStoredSchema = z.object({ reference: z.string() });

function failureOf(error: unknown): ReportFailure {
  if (!(error instanceof AppError)) return "unavailable";
  if (error.code === "INSTALLATION_REQUIRED") return "credential";
  if (error.status === 401) return "credential";
  if (error.status === 404) return "disabled";
  if (error.status === 429) return "quota";
  if (error.kind === "network" || error.kind === "timeout") return "network";
  return "unavailable";
}

export async function submitReport(
  prepared: PreparedReport,
  note?: string,
): Promise<ReportOutcome> {
  const manual = prepared.kind !== "crash_auto";
  if (
    manual &&
    lastManualSubmitAt !== null &&
    now() - lastManualSubmitAt < MANUAL_REPORT_INTERVAL_MS
  )
    return { status: "failed", reason: "throttled" };

  let headers: Record<string, string>;
  let created: z.infer<typeof createdSchema>;
  try {
    headers = await ensureInstallationAuthorization();
    const { entries, ...metadata } = prepared;
    const trimmedNote = note?.trim();
    created = await apiClient.post(
      "/v1/mobile/diagnostics/reports",
      {
        ...metadata,
        ...(trimmedNote && manual ? { note: trimmedNote } : {}),
      },
      createdSchema,
      { headers },
    );
    if (manual) lastManualSubmitAt = now();
    if (!created.logUpload.required || entries.length === 0)
      return {
        status: "submitted",
        reference: created.reference,
        logStored: false,
      };
  } catch (error) {
    return { status: "failed", reason: failureOf(error) };
  }

  // 报告在上一步就成立了：日志传不上去也照样给参考号，只是标明没有日志
  try {
    await apiClient.put(
      `/v1/mobile/diagnostics/reports/${encodeURIComponent(prepared.reportId)}/log`,
      toNdjson([...prepared.entries]),
      "application/x-ndjson",
      logStoredSchema,
      { headers, timeoutMs: 20_000 },
    );
    return {
      status: "submitted",
      reference: created.reference,
      logStored: true,
    };
  } catch {
    return {
      status: "submitted",
      reference: created.reference,
      logStored: false,
    };
  }
}
