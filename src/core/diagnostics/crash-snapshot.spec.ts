import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CRASH_SNAPSHOT_MAX_BYTES,
  CRASH_TAIL_ENTRIES,
  buildCrashSnapshot,
  clearCrashSnapshot,
  crashErrorName,
  readCrashSnapshot,
  topFrameName,
  writeCrashSnapshot,
} from "./crash-snapshot";
import { clearLogs, logEvent } from "./log-buffer";
import { recordCrash } from "./crash-capture";

const APP = {
  version: "1.2.3",
  buildNumber: "45",
  runtimeVersion: "1.2.0",
  otaChannel: "production",
  distributionChannel: "direct",
  launchSource: "ota" as const,
  runningUpdateId: "7c5c1363-8685-42b2-864e-38b6790471ca",
};
const PHRASE =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";

beforeEach(async () => {
  clearLogs();
  await AsyncStorage.clear();
});

describe("topFrameName", () => {
  it.each([
    [
      "React 19 component stack",
      "\n    at AssetsScreen (/Users/dev/app/src/assets.tsx:40:12)",
      "AssetsScreen",
    ],
    [
      "pre-19 component stack",
      "\n    in LegacyScreen (at legacy.tsx:4)",
      "LegacyScreen",
    ],
    [
      "Hermes error stack",
      "TypeError: x is undefined\n    at renderRow (address at index.android.bundle:1:2345)",
      "renderRow",
    ],
    ["no stack", undefined, "unknown"],
  ])("%s", (_name, stack, expected) => {
    expect(topFrameName(stack)).toBe(expected);
  });

  it("never keeps the file path", () => {
    expect(
      topFrameName("\n    at Foo (/Users/alice/secret/path.tsx:1:1)"),
    ).toBe("Foo");
  });
});

describe("crashErrorName", () => {
  it("accepts a class name and refuses anything else", () => {
    expect(crashErrorName(new TypeError("x"))).toBe("TypeError");
    const tampered = new Error("x");
    tampered.name = `leak ${PHRASE}`;
    expect(crashErrorName(tampered)).toBe("UnknownError");
    expect(crashErrorName("a bare string")).toBe("UnknownError");
  });
});

describe("buildCrashSnapshot", () => {
  it("keeps only the newest tail entries and stays under the size cap", () => {
    for (let i = 0; i < 400; i += 1)
      logEvent("info", "nav", "x".repeat(500), { i });
    const snapshot = buildCrashSnapshot({
      at: 1,
      source: "render",
      error: new Error("boom"),
      stack: undefined,
      app: APP,
    });
    expect(snapshot.tail.length).toBeLessThanOrEqual(CRASH_TAIL_ENTRIES);
    expect(JSON.stringify(snapshot).length).toBeLessThanOrEqual(
      CRASH_SNAPSHOT_MAX_BYTES,
    );
    // 裁掉的是最旧的：最后一条一定还在
    expect(snapshot.tail.at(-1)?.fields?.i).toBe(399);
  });
});

describe("persisted snapshot", () => {
  it("round-trips", async () => {
    logEvent("error", "net", "request failed");
    const snapshot = buildCrashSnapshot({
      at: 5,
      source: "global",
      error: new Error("x"),
      stack: undefined,
      app: APP,
    });
    await writeCrashSnapshot(snapshot);
    await expect(readCrashSnapshot()).resolves.toEqual(snapshot);
    await clearCrashSnapshot();
    await expect(readCrashSnapshot()).resolves.toBeNull();
  });

  it("drops a snapshot that does not have the expected shape", async () => {
    await AsyncStorage.setItem(
      "foundation.diagnostics.pending-crash.v1",
      JSON.stringify({ version: 1, errorName: "has spaces" }),
    );
    await expect(readCrashSnapshot()).resolves.toBeNull();
    await expect(
      AsyncStorage.getItem("foundation.diagnostics.pending-crash.v1"),
    ).resolves.toBeNull();
  });

  // T16：快照会在磁盘上待到下次启动。崩溃消息里的助记词不能跟着落盘
  it("never writes a recovery phrase carried by the crash to disk", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    recordCrash("render", new Error(`import failed: ${PHRASE}`), {
      componentStack: "\n    at WalletImportScreen (x.tsx:1:1)",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const raw = await AsyncStorage.getItem(
      "foundation.diagnostics.pending-crash.v1",
    );
    expect(raw).not.toBeNull();
    expect(raw).not.toContain("sausage");
    expect(raw).toContain("[redacted:secret]");
    jest.restoreAllMocks();
  });

  it("does not leave a snapshot for a non-fatal global error", async () => {
    recordCrash("global", new Error("minor"), { fatal: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(readCrashSnapshot()).resolves.toBeNull();
  });
});
