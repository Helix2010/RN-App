import {
  createRouteLogger,
  installGlobalCrashCapture,
  recordCrash,
  resetCrashCaptureForTest,
} from "./crash-capture";
import {
  clearLogs,
  resetSecretLeakCount,
  secretLeakCount,
  snapshotLogs,
} from "./log-buffer";
import { REDACTED } from "../security/secret-scan";

const PHRASE =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";

beforeEach(() => {
  clearLogs();
  resetSecretLeakCount();
});

describe("recordCrash", () => {
  it("records the error and the top component of a render crash", () => {
    // React 19 的真实格式（从一次真实渲染里抓出来的，不是手写的）
    recordCrash("render", new TypeError("cannot read x of undefined"), {
      componentStack:
        "\n    at AssetsScreen (/home/dev/app/src/assets-screen.tsx:40:12)\n    at AppShell (/home/dev/app/src/app-shell.tsx:9:3)",
    });
    expect(snapshotLogs()[0]).toMatchObject({
      level: "error",
      tag: "crash",
      message: "TypeError: cannot read x of undefined",
      fields: { source: "render", component: "AssetsScreen" },
    });
    // 帧里的文件路径（开发构建下含用户名）不进日志
    expect(JSON.stringify(snapshotLogs())).not.toContain("/home/dev");
  });

  it("still reads the pre-19 component stack format", () => {
    recordCrash("render", new Error("boom"), {
      componentStack: "\n    in LegacyScreen (at legacy.tsx:4)\n    in Root",
    });
    expect(snapshotLogs()[0]?.fields?.component).toBe("LegacyScreen");
  });

  it("records whether a global error was fatal", () => {
    recordCrash("global", new Error("boom"), { fatal: true });
    expect(snapshotLogs()[0]?.fields).toEqual({
      source: "global",
      fatal: true,
    });
  });

  it("survives a thrown non-Error", () => {
    recordCrash("global", "a bare string");
    expect(snapshotLogs()[0]?.message).toBe("NonErrorThrown: ");
    // 抛出来的字符串本身不受我们控制，不进日志
    expect(JSON.stringify(snapshotLogs())).not.toContain("bare string");
  });

  it("redacts a recovery phrase carried by the crash message", () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    recordCrash("render", new Error(`import failed: ${PHRASE}`));
    expect(snapshotLogs()[0]?.message).toContain(REDACTED);
    expect(secretLeakCount()).toBe(1);
    jest.restoreAllMocks();
  });
});

describe("installGlobalCrashCapture", () => {
  const original = ErrorUtils.getGlobalHandler();
  afterEach(() => {
    ErrorUtils.setGlobalHandler(original);
    resetCrashCaptureForTest();
  });

  it("records the crash and still hands it to the previous handler", () => {
    const previous = jest.fn();
    ErrorUtils.setGlobalHandler(previous);
    installGlobalCrashCapture();

    const error = new Error("fatal");
    ErrorUtils.getGlobalHandler()(error, true);

    expect(snapshotLogs()[0]?.fields).toMatchObject({
      source: "global",
      fatal: true,
    });
    // RN 自己的红屏与崩溃行为必须照旧
    expect(previous).toHaveBeenCalledWith(error, true);
  });

  it("installs once even when called again after a hot reload", () => {
    const previous = jest.fn();
    ErrorUtils.setGlobalHandler(previous);
    installGlobalCrashCapture();
    installGlobalCrashCapture();

    ErrorUtils.getGlobalHandler()(new Error("once"), false);
    expect(snapshotLogs()).toHaveLength(1);
    expect(previous).toHaveBeenCalledTimes(1);
  });
});

describe("createRouteLogger", () => {
  it("records each route change once and skips repeats", () => {
    const log = createRouteLogger();
    log("AppShell");
    log("AppShell");
    log("Settings");
    log(undefined);
    expect(snapshotLogs().map((entry) => entry.fields?.name)).toEqual([
      "AppShell",
      "Settings",
    ]);
  });
});
