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
  error?: unknown;
};

export type UpdateTelemetrySink = (event: {
  stage: UpdateTelemetry["stage"];
  updateId?: string;
  runtimeVersion?: string;
  channel?: string;
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

export function emitUpdateTelemetry(event: UpdateTelemetry): void {
  try {
    sink({
      stage: event.stage,
      updateId: safeString(event.updateId),
      runtimeVersion: safeString(event.runtimeVersion),
      channel: safeString(event.channel),
    });
  } catch {
    // Telemetry must never affect update safety or app startup.
  }
}
