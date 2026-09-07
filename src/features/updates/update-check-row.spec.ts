import type { OtaCheckResult } from "../../core/updates/update-service";
import { updateCheckRowValue } from "./update-check-row";

const t = (key: string): string => key;

function ota(
  status: OtaCheckResult["status"],
  messageKey: string,
): OtaCheckResult {
  return {
    status,
    messageKey,
    metadata: {
      updateId: "update-1",
      runtimeVersion: "1.2.9",
      channel: "production",
      isEmbedded: false,
      createdAt: null,
      applyStrategy: "next_launch",
    },
  };
}

describe("updateCheckRowValue", () => {
  it("shows checking and error states first", () => {
    expect(
      updateCheckRowValue({
        t,
        state: "checking",
        hasUpdate: false,
        latestVersion: "1.2.9",
        otaResult: ota("ready", "update.otaReadyNextLaunch"),
      }),
    ).toBe("update.checking");
    expect(
      updateCheckRowValue({
        t,
        state: "error",
        hasUpdate: false,
        latestVersion: "1.2.9",
        otaResult: null,
      }),
    ).toBe("status.error");
  });

  it("prefers the full release when the server decided one is available", () => {
    expect(
      updateCheckRowValue({
        t: (key) => (key === "settings.newVersion" ? "v{version}" : key),
        state: "available",
        hasUpdate: true,
        latestVersion: "1.3.0",
        otaResult: ota("ready", "update.otaReadyNextLaunch"),
      }),
    ).toBe("v1.3.0");
  });

  it("reports a downloaded OTA even before the user taps the row", () => {
    expect(
      updateCheckRowValue({
        t,
        state: "idle",
        hasUpdate: false,
        latestVersion: "1.2.9",
        otaResult: ota("ready", "update.otaReadyNextLaunch"),
      }),
    ).toBe("update.otaReadyNextLaunch");
    expect(
      updateCheckRowValue({
        t,
        state: "latest",
        hasUpdate: false,
        latestVersion: "1.2.9",
        otaResult: ota("error", "update.otaIncompatible"),
      }),
    ).toBe("update.otaIncompatible");
  });

  it("says up to date only when nothing is pending", () => {
    expect(
      updateCheckRowValue({
        t,
        state: "latest",
        hasUpdate: false,
        latestVersion: "1.2.9",
        otaResult: ota("current", "update.otaCurrent"),
      }),
    ).toBe("settings.upToDate");
    expect(
      updateCheckRowValue({
        t,
        state: "idle",
        hasUpdate: false,
        latestVersion: "1.2.9",
        otaResult: null,
      }),
    ).toBe("settings.upToDate");
  });
});
