import { act, renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { RuntimeContext } from "../../app/runtime-context";
import { createFallbackConfig } from "../../core/config/fallback-config";
import { buildRuntime } from "../../test/harness";
import { useManualUpdateCheck } from "./use-manual-update-check";

function wrapperWith(checkForUpdates: jest.Mock) {
  const runtime = buildRuntime({ runtime: { checkForUpdates } });
  function RuntimeWrapper({ children }: { children: ReactNode }) {
    return (
      <RuntimeContext.Provider value={runtime}>
        {children}
      </RuntimeContext.Provider>
    );
  }
  return RuntimeWrapper;
}

const snapshot = {
  config: createFallbackConfig("zh-CN"),
  source: "remote" as const,
};

describe("useManualUpdateCheck", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("retries once after a transient failure and ends up with the second result", async () => {
    const checkForUpdates = jest
      .fn()
      .mockResolvedValueOnce({ kind: "error", error: new Error("timeout") })
      .mockResolvedValueOnce({ kind: "none", snapshot });
    const { result } = await renderHook(() => useManualUpdateCheck(), {
      wrapper: wrapperWith(checkForUpdates),
    });
    let pending: Promise<unknown> | undefined;
    await act(async () => {
      pending = result.current.check();
      await Promise.resolve();
    });
    expect(result.current.state).toBe("checking");
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_500);
      await pending;
    });
    expect(checkForUpdates).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe("latest");
  });

  it("reports the error only when the retry fails as well", async () => {
    const checkForUpdates = jest
      .fn()
      .mockResolvedValue({ kind: "error", error: new Error("offline") });
    const { result } = await renderHook(() => useManualUpdateCheck(), {
      wrapper: wrapperWith(checkForUpdates),
    });
    let pending: Promise<unknown> | undefined;
    await act(async () => {
      pending = result.current.check();
      await Promise.resolve();
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1_500);
      await pending;
    });
    expect(checkForUpdates).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe("error");
  });
});
