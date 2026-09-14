import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  beginLaunch,
  completeManualCrashReport,
  crashFingerprint,
  preparePendingCrashReport,
  processPendingCrash,
  resetLaunchForTest,
} from "./crash-reporter";
import {
  readCrashGates,
  recordCrashSent,
  recordLaunchCrashed,
  recordLaunchStart,
  suspendAutoReports,
} from "./crash-gates";
import {
  buildCrashSnapshot,
  readCrashSnapshot,
  writeCrashSnapshot,
} from "./crash-snapshot";
import { clearLogs, logEvent } from "./log-buffer";

jest.mock("expo-crypto", () => {
  const { createHash } =
    jest.requireActual<typeof import("node:crypto")>("node:crypto");
  let counter = 0;
  return {
    CryptoDigestAlgorithm: { SHA256: "SHA-256" },
    digestStringAsync: async (_algorithm: string, value: string) =>
      createHash("sha256").update(value).digest("hex"),
    randomUUID: () =>
      `0123456789ab4def8123${String((counter += 1)).padStart(12, "0")}`,
  };
});
jest.mock("../device/installation-service", () => ({
  ensureInstallationAuthorization: async () => ({}),
  runningBundle: () => ({ launchSource: "embedded" }),
  deviceDescriptor: () => ({ osVersion: "35", deviceClass: "android-phone" }),
}));
const mockSubmit = jest.fn();
jest.mock("./report-service", () => ({
  ...jest.requireActual("./report-service"),
  submitReport: (...args: unknown[]) => mockSubmit(...args),
}));

// 崩溃那一版：跟"现在在跑的"（上面 mock 的 embedded）故意不一样
const CRASHED_BUILD = {
  version: "1.2.3",
  buildNumber: "45",
  runtimeVersion: "1.2.0",
  otaChannel: "production",
  distributionChannel: "direct",
  launchSource: "ota" as const,
  runningUpdateId: "7c5c1363-8685-42b2-864e-38b6790471ca",
};
const ENABLED = { remoteEnabled: true, userEnabled: true, locale: "zh-CN" };

async function crash(errorName = "TypeError", frame = "renderRow") {
  clearLogs();
  logEvent("error", "crash", `${errorName}: boom`);
  const error = new Error("boom");
  error.name = errorName;
  await writeCrashSnapshot(
    buildCrashSnapshot({
      at: Date.UTC(2026, 8, 14, 7),
      source: "global",
      error,
      stack: `\n    at ${frame} (address at index.android.bundle:1:1)`,
      app: CRASHED_BUILD,
    }),
  );
}

const submitted = {
  status: "submitted",
  reference: "R7KQ3M2X",
  logStored: true,
};

beforeEach(async () => {
  await AsyncStorage.clear();
  resetLaunchForTest();
  mockSubmit.mockReset();
});

describe("processPendingCrash", () => {
  it("does nothing without a snapshot", async () => {
    await expect(processPendingCrash(ENABLED)).resolves.toBe("none");
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("sends the crash with the build that crashed, its log tail and time, then clears it", async () => {
    await crash();
    mockSubmit.mockResolvedValue(submitted);

    await expect(processPendingCrash(ENABLED)).resolves.toBe("sent");

    const [prepared] = mockSubmit.mock.calls[0] as [Record<string, unknown>];
    expect(prepared).toMatchObject({
      kind: "crash_auto",
      occurredAt: "2026-09-14T07:00:00.000Z",
      crash: {
        errorName: "TypeError",
        fingerprint: await crashFingerprint("TypeError", "renderRow"),
      },
      app: {
        version: "1.2.3",
        launchSource: "ota",
        runningUpdateId: CRASHED_BUILD.runningUpdateId,
      },
    });
    expect((prepared.entries as unknown[]).length).toBe(1);
    await expect(readCrashSnapshot()).resolves.toBeNull();
    const gates = await readCrashGates();
    expect(gates.autoCount).toBe(1);
    expect(gates.sent).toHaveLength(1);
  });

  it.each([
    ["the tenant switched it off", { ...ENABLED, remoteEnabled: false }],
    ["the user switched it off", { ...ENABLED, userEnabled: false }],
  ])(
    "leaves the snapshot for a manual report when %s",
    async (_name, input) => {
      await crash();
      await expect(processPendingCrash(input)).resolves.toBe("prompt");
      expect(mockSubmit).not.toHaveBeenCalled();
      await expect(readCrashSnapshot()).resolves.not.toBeNull();
    },
  );

  it("stops automatic reports in a crash loop instead of uploading every launch", async () => {
    // 三次启动都崩了、都没活过 60 秒
    for (let i = 0; i < 3; i += 1) {
      await recordLaunchStart(1_000 + i);
      await recordLaunchCrashed(1_000 + i);
    }
    beginLaunch();
    await crash();

    await expect(processPendingCrash(ENABLED)).resolves.toBe("suspended");
    expect(mockSubmit).not.toHaveBeenCalled();
    await expect(readCrashSnapshot()).resolves.toBeNull();
    expect((await readCrashGates()).suspended).toBe(true);
  });

  // 打开钱包看一眼余额就关是常态：连着三次这样用不能让自动上报被熔断
  it("does not mistake three quick sessions for a crash loop", async () => {
    for (let i = 0; i < 3; i += 1) await recordLaunchStart(1_000 + i);
    beginLaunch();
    await crash();
    mockSubmit.mockResolvedValue(submitted);

    await expect(processPendingCrash(ENABLED)).resolves.toBe("sent");
    expect((await readCrashGates()).suspended).toBe(false);
  });

  it("keeps a new snapshot for the user while automatic reports are suspended", async () => {
    await suspendAutoReports();
    await crash();
    await expect(processPendingCrash(ENABLED)).resolves.toBe("prompt");
    await expect(readCrashSnapshot()).resolves.not.toBeNull();
  });

  it("discards a crash already sent within 24 hours", async () => {
    await recordCrashSent({
      fingerprint: await crashFingerprint("TypeError", "renderRow"),
      at: Date.now(),
      automatic: true,
    });
    await crash();
    await expect(processPendingCrash(ENABLED)).resolves.toBe("discarded");
    expect(mockSubmit).not.toHaveBeenCalled();
    await expect(readCrashSnapshot()).resolves.toBeNull();
  });

  it("discards once three automatic reports went out today", async () => {
    for (let i = 0; i < 3; i += 1)
      await recordCrashSent({
        fingerprint: `other${i}`,
        at: Date.now(),
        automatic: true,
      });
    await crash();
    await expect(processPendingCrash(ENABLED)).resolves.toBe("discarded");
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it("drops the snapshot when the server refuses, keeps it when the network failed", async () => {
    await crash();
    mockSubmit.mockResolvedValue({ status: "failed", reason: "network" });
    await expect(processPendingCrash(ENABLED)).resolves.toBe("retry");
    await expect(readCrashSnapshot()).resolves.not.toBeNull();

    mockSubmit.mockResolvedValue({ status: "failed", reason: "quota" });
    await expect(processPendingCrash(ENABLED)).resolves.toBe("discarded");
    await expect(readCrashSnapshot()).resolves.toBeNull();
  });
});

describe("manual crash report", () => {
  it("turns the snapshot into a crash report, and sending it clears the snapshot and the suspension", async () => {
    await suspendAutoReports();
    await crash("RangeError", "formatAmount");
    const pending = await preparePendingCrashReport("zh-CN");
    expect(pending?.prepared).toMatchObject({
      kind: "crash",
      crash: { errorName: "RangeError" },
      app: { version: "1.2.3" },
    });

    await completeManualCrashReport(pending!.prepared, submitted as never);

    await expect(readCrashSnapshot()).resolves.toBeNull();
    const gates = await readCrashGates();
    expect(gates.suspended).toBe(false);
    // 记下了指纹：下次启动不会再把同一个崩溃自动发一遍；手动的不占自动配额
    expect(gates.sent.map((item) => item.fingerprint)).toEqual([
      pending!.fingerprint,
    ]);
    expect(gates.autoCount).toBe(0);
  });

  it("changes nothing when the manual report did not go through", async () => {
    await crash();
    const pending = await preparePendingCrashReport("zh-CN");
    await completeManualCrashReport(pending!.prepared, {
      status: "failed",
      reason: "network",
    });
    await expect(readCrashSnapshot()).resolves.not.toBeNull();
  });
});
