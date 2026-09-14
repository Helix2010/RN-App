import {
  emitUpdateTelemetry,
  setUpdateTelemetrySink,
} from "./update-telemetry";
import { clearLogs, snapshotLogs } from "../diagnostics/log-buffer";

beforeEach(() => clearLogs());

describe("update telemetry adapter", () => {
  it("only forwards bounded update identity fields", () => {
    const events: unknown[] = [];
    const restore = setUpdateTelemetrySink((event) => events.push(event));
    emitUpdateTelemetry({
      stage: "ready",
      updateId: "update-safe",
      runtimeVersion: "runtime-safe",
      channel: "production",
      applyStrategy: "immediate",
      error: new Error("secret-token-should-not-be-forwarded"),
    });
    restore();
    expect(events).toEqual([
      {
        stage: "ready",
        updateId: "update-safe",
        runtimeVersion: "runtime-safe",
        channel: "production",
        applyStrategy: "immediate",
      },
    ]);
  });

  it("writes the OTA timeline to the diagnostics log without the error message", () => {
    const error = Object.assign(
      new Error("secret-token-should-not-be-logged"),
      { code: "ERR_UPDATES_FETCH" },
    );
    emitUpdateTelemetry({ stage: "checking" });
    emitUpdateTelemetry({ stage: "error", updateId: "update-1", error });

    expect(snapshotLogs()).toEqual([
      expect.objectContaining({
        level: "info",
        tag: "ota",
        fields: { stage: "checking" },
      }),
      expect.objectContaining({
        level: "error",
        tag: "ota",
        fields: {
          stage: "error",
          updateId: "update-1",
          errorCode: "ERR_UPDATES_FETCH",
        },
      }),
    ]);
    expect(JSON.stringify(snapshotLogs())).not.toContain("secret-token");
  });

  it("ignores an error code that is not shaped like one", () => {
    // code 字段同样不受我们控制；形状不对就当没有
    emitUpdateTelemetry({
      stage: "error",
      error: { code: "free text with a mnemonic maybe" },
    });
    expect(snapshotLogs()[0]?.fields).toEqual({ stage: "error" });
  });
});
