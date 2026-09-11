import { renderHook } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { useScrubbedClipboard } from "./use-scrubbed-clipboard";

jest.mock("../../design-system", () => ({ toast: jest.fn() }));

const setString = jest.mocked(Clipboard.setStringAsync);
const getString = jest.mocked(Clipboard.getStringAsync);

const SECRET = "abandon ability able about above absent";
const MESSAGES = { success: "copied", failure: "failed" };

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  setString.mockResolvedValue(true);
  getString.mockResolvedValue(SECRET);
});

afterEach(() => {
  jest.useRealTimers();
});

/** 让排在微任务队列里的剪贴板读写跑完 */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("useScrubbedClipboard", () => {
  it("wipes the secret once the window is over", async () => {
    const { result } = await renderHook(() => useScrubbedClipboard(1_000));
    await result.current.copy(SECRET, MESSAGES);
    expect(setString).toHaveBeenCalledWith(SECRET);
    jest.advanceTimersByTime(1_000);
    await settle();
    expect(setString).toHaveBeenLastCalledWith("");
  });

  it("leaves the clipboard alone when the user copied something else", async () => {
    const { result } = await renderHook(() => useScrubbedClipboard(1_000));
    await result.current.copy(SECRET, MESSAGES);
    getString.mockResolvedValue("a shopping list");
    jest.advanceTimersByTime(1_000);
    await settle();
    // 清掉的会是用户自己的内容
    expect(setString).not.toHaveBeenLastCalledWith("");
  });

  it("wipes immediately when the screen goes away inside the window", async () => {
    const view = await renderHook(() => useScrubbedClipboard(60_000));
    await view.result.current.copy(SECRET, MESSAGES);
    // RNTL 的 unmount 返回 Thenable；这里是同步卸载，明确忽略返回值
    void view.unmount();
    await settle();
    // 只取消定时器的话，机密会无限期留在剪贴板里
    expect(setString).toHaveBeenLastCalledWith("");
  });

  it("does not touch the clipboard when nothing was copied", async () => {
    const view = await renderHook(() => useScrubbedClipboard(1_000));
    // RNTL 的 unmount 返回 Thenable；这里是同步卸载，明确忽略返回值
    void view.unmount();
    await settle();
    expect(setString).not.toHaveBeenCalled();
  });

  it("only tracks the most recent copy", async () => {
    const { result } = await renderHook(() => useScrubbedClipboard(1_000));
    await result.current.copy(SECRET, MESSAGES);
    await result.current.copy("second secret", MESSAGES);
    getString.mockResolvedValue("second secret");
    jest.advanceTimersByTime(1_000);
    await settle();
    expect(setString).toHaveBeenLastCalledWith("");
    // 第一次的定时器被取消，不会在更晚的时候再抹一次
    jest.advanceTimersByTime(10_000);
    await settle();
    expect(setString.mock.calls.filter(([v]) => v === "")).toHaveLength(1);
  });

  it("survives a clipboard read that fails instead of guessing", async () => {
    const { result } = await renderHook(() => useScrubbedClipboard(1_000));
    await result.current.copy(SECRET, MESSAGES);
    getString.mockRejectedValue(new Error("denied"));
    jest.advanceTimersByTime(1_000);
    await settle();
    expect(setString).not.toHaveBeenLastCalledWith("");
  });
});
