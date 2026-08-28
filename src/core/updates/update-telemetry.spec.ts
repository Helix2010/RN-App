import {
  emitUpdateTelemetry,
  setUpdateTelemetrySink,
} from "./update-telemetry";

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
});
