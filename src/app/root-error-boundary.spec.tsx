import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { Text } from "react-native";
import { RootErrorBoundary } from "./root-error-boundary";
import {
  installGlobalCrashCapture,
  resetCrashCaptureForTest,
} from "../core/diagnostics/crash-capture";
import {
  clearLogs,
  resetSecretLeakCount,
  secretLeakCount,
  snapshotLogs,
} from "../core/diagnostics/log-buffer";

jest.mock("expo-localization", () => ({
  getLocales: () => [{ languageCode: "zh" }],
}));
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: async () => "a1b2c3d4e5f60718".repeat(4),
  randomUUID: () => "0123456789ab4def8123456789abcdef",
}));
const mockReload = jest.fn();
jest.mock("expo-updates", () => ({
  ...jest.requireActual("expo-updates"),
  reloadAsync: (...args: unknown[]) => mockReload(...args),
}));
const mockSubmit = jest.fn();
jest.mock("../core/diagnostics/report-service", () => ({
  ...jest.requireActual("../core/diagnostics/report-service"),
  submitReport: (...args: unknown[]) => mockSubmit(...args),
}));

// 种一句 canary 助记词，让它走完整条崩溃路径（安全评审 §12.2）。词是真的
// BIP-39 词，但这串助记词只存在于测试里，没有任何资产
const CANARY_PHRASE =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";

let explode = true;
let crashMessage = "render exploded";
function Child() {
  if (explode) throw new Error(crashMessage);
  return <Text testID="child">ok</Text>;
}

describe("RootErrorBoundary", () => {
  beforeEach(() => {
    explode = true;
    crashMessage = "render exploded";
    clearLogs();
    resetSecretLeakCount();
    mockSubmit.mockReset();
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it("turns a render crash into a screen with retry and a report, and recovers on retry", async () => {
    mockSubmit.mockResolvedValue({
      status: "submitted",
      reference: "R7KQ3M2X",
      logStored: true,
    });
    await render(
      <RootErrorBoundary>
        <Child />
      </RootErrorBoundary>,
    );

    expect(screen.getByTestId("root-error-boundary")).toBeTruthy();
    expect(screen.getByText(/render exploded/)).toBeTruthy();
    // 崩溃也进诊断日志——那是「上报问题」会带走的内容
    expect(snapshotLogs()).toContainEqual(
      expect.objectContaining({
        tag: "crash",
        message: "Error: render exploded",
        fields: expect.objectContaining({
          source: "render",
          component: "Child",
        }) as unknown,
      }),
    );

    await fireEvent.press(screen.getByTestId("root-error-report"));
    await waitFor(() =>
      expect(screen.getByTestId("root-error-reference")).toBeTruthy(),
    );
    expect(screen.getByText("R7KQ3M2X")).toBeTruthy();
    const [prepared] = mockSubmit.mock.calls[0] as [Record<string, unknown>];
    expect(prepared).toMatchObject({
      kind: "crash",
      crash: { errorName: "Error" },
    });

    explode = false;
    await fireEvent.press(screen.getByTestId("root-error-retry"));
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  // 发布构建里致命全局异常不再交给 RN 的默认处理器（那会销毁 React 实例、留下白屏）
  it("shows a restartable crash page for a fatal global error in a release build", async () => {
    const dev = __DEV__;
    const original = ErrorUtils.getGlobalHandler();
    const previous = jest.fn();
    (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
    ErrorUtils.setGlobalHandler(previous);
    installGlobalCrashCapture();
    mockReload.mockResolvedValue(undefined);
    explode = false;
    try {
      await render(
        <RootErrorBoundary>
          <Child />
        </RootErrorBoundary>,
      );
      expect(screen.getByTestId("child")).toBeTruthy();

      await act(async () => {
        ErrorUtils.getGlobalHandler()(new Error("timer exploded"), true);
      });
      expect(screen.getByTestId("root-error-boundary")).toBeTruthy();
      expect(screen.getByText(/timer exploded/)).toBeTruthy();
      expect(previous).not.toHaveBeenCalled();
      // 模块级状态可能已经坏了：只给重启，不给重挂载
      expect(screen.queryByTestId("root-error-retry")).toBeNull();
      await fireEvent.press(screen.getByTestId("root-error-restart"));
      expect(mockReload).toHaveBeenCalledTimes(1);
    } finally {
      (globalThis as unknown as { __DEV__: boolean }).__DEV__ = dev;
      ErrorUtils.setGlobalHandler(original);
      resetCrashCaptureForTest();
    }
  });

  it("says so when the report fails, and does not crash itself", async () => {
    mockSubmit.mockRejectedValue(new Error("unexpected"));
    await render(
      <RootErrorBoundary>
        <Child />
      </RootErrorBoundary>,
    );
    await fireEvent.press(screen.getByTestId("root-error-report"));
    await waitFor(() =>
      expect(screen.getByTestId("root-error-report-failed")).toBeTruthy(),
    );
    expect(screen.getByTestId("root-error-boundary")).toBeTruthy();
  });

  // 崩溃报告会离开设备，而 error.message 的内容不受我们控制（导入失败、解密失败都会把
  // 输入拼进异常）。canary 走完整条路径，断言它到不了上报内容，也到不了 console
  it("never lets a recovery phrase reach the report or the log", async () => {
    mockSubmit.mockResolvedValue({
      status: "submitted",
      reference: "R7KQ3M2X",
      logStored: true,
    });
    crashMessage = `failed to import wallet: ${CANARY_PHRASE}`;
    await render(
      <RootErrorBoundary>
        <Child />
      </RootErrorBoundary>,
    );
    await fireEvent.press(screen.getByTestId("root-error-report"));
    await waitFor(() => expect(mockSubmit).toHaveBeenCalled());

    const sent = JSON.stringify(mockSubmit.mock.calls[0]?.[0]);
    expect(sent).not.toContain("sausage");
    expect(sent).toContain("[redacted:secret]");

    // 只断言边界自己那条日志。React 在开发模式下会先用 console.error 打印
    // 一遍原始错误（"Caught error: …"），那是 React 内部的行为，错误边界拦不住
    // 它——这一条是 canary 扫描扫出来的真实残留风险，记在变更记录里。
    // 真正的修法在上游：不要把秘密拼进异常 message。
    const ours = jest
      .mocked(console.error)
      .mock.calls.filter((call) =>
        String(call[0]).includes("root-error-boundary"),
      )
      .flat()
      .join(" ");
    expect(ours).not.toContain("sausage");
    expect(ours).toContain("[redacted:secret]");

    // 命中即缺陷：出口扫描计了数，说明上游把秘密拼进了异常 message
    expect(secretLeakCount()).toBeGreaterThan(0);
  });
});
