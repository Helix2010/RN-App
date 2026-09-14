import { logEvent } from "../diagnostics/log-buffer";

export type UpdateTelemetry = {
  stage:
    | "checking"
    | "available"
    | "downloading"
    | "ready"
    | "applying"
    | "current"
    | "rollback"
    | "error";
  updateId?: unknown;
  runtimeVersion?: unknown;
  channel?: unknown;
  applyStrategy?: unknown;
  error?: unknown;
};

export type UpdateTelemetrySink = (event: {
  stage: UpdateTelemetry["stage"];
  updateId?: string;
  runtimeVersion?: string;
  channel?: string;
  applyStrategy?: "next_launch" | "immediate";
}) => void;

let sink: UpdateTelemetrySink = () => undefined;

export function setUpdateTelemetrySink(next: UpdateTelemetrySink): () => void {
  const previous = sink;
  sink = next;
  return () => {
    sink = previous;
  };
}

function safeString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return value.slice(0, 160);
}

/**
 * 错误只取**形状合规的错误码**（expo-updates 的 `ERR_UPDATES_FETCH` 这类），
 * 不取 message：message 的内容不受我们控制，上面那个用例专门守着这一点。
 */
function safeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(code)
    ? code
    : undefined;
}

const STAGE_LEVEL: Record<UpdateTelemetry["stage"], "info" | "warn" | "error"> =
  {
    checking: "info",
    available: "info",
    downloading: "info",
    ready: "info",
    applying: "info",
    current: "info",
    rollback: "warn",
    error: "error",
  };

export function emitUpdateTelemetry(event: UpdateTelemetry): void {
  const safe = {
    stage: event.stage,
    updateId: safeString(event.updateId),
    runtimeVersion: safeString(event.runtimeVersion),
    channel: safeString(event.channel),
    applyStrategy:
      event.applyStrategy === "immediate"
        ? ("immediate" as const)
        : ("next_launch" as const),
  };
  // OTA 时间线进诊断日志（设计 diagnostic-report-2026-09-14 §4.2）。
  // 用户说"更新没生效"时，这一串 checking → downloading → ready 就是答案
  const errorCode = safeErrorCode(event.error);
  logEvent(STAGE_LEVEL[safe.stage], "ota", "update stage", {
    stage: safe.stage,
    ...(safe.updateId ? { updateId: safe.updateId } : {}),
    ...(safe.runtimeVersion ? { runtimeVersion: safe.runtimeVersion } : {}),
    ...(safe.channel ? { channel: safe.channel } : {}),
    ...(errorCode ? { errorCode } : {}),
  });
  try {
    sink(safe);
  } catch {
    // Telemetry must never affect update safety or app startup.
  }
}
