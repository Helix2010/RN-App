import { fireEvent, render, screen } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { Text } from "react-native";
import { RootErrorBoundary } from "./root-error-boundary";
import {
  clearLogs,
  secretLeakCount,
  resetSecretLeakCount,
  snapshotLogs,
} from "../core/diagnostics/log-buffer";

jest.mock("expo-localization", () => ({
  getLocales: () => [{ languageCode: "zh" }],
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
    jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it("turns a render crash into a screen with retry and diagnostics, and recovers on retry", async () => {
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
    expect(
      screen.getByTestId("root-error-diagnostic-id").props.children.join(""),
    ).toMatch(/诊断 ID: [0-9a-z]+-[0-9a-z]+/);

    await fireEvent.press(screen.getByTestId("root-error-copy"));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
      expect.stringContaining("error: Error: render exploded"),
    );

    explode = false;
    await fireEvent.press(screen.getByTestId("root-error-retry"));
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  // 崩溃诊断会被复制到剪贴板、由用户自己发给客服——这是少数几个"内容离开设备"
  // 的出口，而 error.message 的内容不受我们控制（导入失败、解密失败都会把输入
  // 拼进异常）。canary 走完整条路径，断言它到不了剪贴板，也到不了 console
  it("never lets a recovery phrase reach the clipboard or the log", async () => {
    crashMessage = `failed to import wallet: ${CANARY_PHRASE}`;
    await render(
      <RootErrorBoundary>
        <Child />
      </RootErrorBoundary>,
    );

    await fireEvent.press(screen.getByTestId("root-error-copy"));

    const copied = jest.mocked(Clipboard.setStringAsync).mock.calls.at(-1)?.[0];
    expect(copied).toBeDefined();
    expect(copied).not.toContain("sausage");
    expect(copied).toContain("[redacted:secret]");
    // 诊断本身仍然可读：遮蔽的是助记词，不是整段
    expect(copied).toContain("diagnosticId:");
    expect(copied).toContain("componentStack:");

    // 只断言边界自己那条日志。React 在开发模式下会先用 console.error 打印
    // 一遍原始错误（"Caught error: …"），那是 React 内部的行为，错误边界拦不住
    // 它——这一条是这次 canary 扫描扫出来的真实残留风险，记在变更记录里。
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

    // 第三个出口：诊断日志缓冲，「上报问题」会把它传给服务端
    const uploaded = JSON.stringify(snapshotLogs());
    expect(uploaded).not.toContain("sausage");
    expect(uploaded).toContain("[redacted:secret]");
    // 命中即缺陷：出口扫描计了数，说明上游把秘密拼进了异常 message
    expect(secretLeakCount()).toBeGreaterThan(0);
  });
});
