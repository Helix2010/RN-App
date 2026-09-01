import { act, renderHook } from "@testing-library/react-native";
import { useAsyncAction } from "./use-async-action";

// jest.mock 会被提升到 import 之前执行，所以 useAsyncAction 拿到的是这个假 toast
const mockToast = jest.fn();
jest.mock("./toast", () => ({
  toast: (text: string, kind: string) => mockToast(text, kind),
}));

function messages() {
  return mockToast.mock.calls.map(([text]) => text as string);
}

beforeEach(() => {
  mockToast.mockClear();
});

describe("useAsyncAction", () => {
  it("reports failures instead of swallowing them", async () => {
    const action = jest.fn(async () => {
      throw new Error("storage full");
    });
    const { result } = await renderHook(() =>
      useAsyncAction(action, { failureMessage: "没成功，请重试" }),
    );

    await act(async () => {
      result.current.run();
    });

    expect(messages()).toContain("没成功，请重试");
    expect(result.current.pending).toBe(false);
  });

  it("marks itself pending while the action runs", async () => {
    let release!: () => void;
    const action = jest.fn(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const { result } = await renderHook(() =>
      useAsyncAction(action, { failureMessage: "失败" }),
    );

    await act(async () => {
      result.current.run();
    });
    expect(result.current.pending).toBe(true);

    await act(async () => {
      release();
    });
    expect(result.current.pending).toBe(false);
  });

  it("ignores a second tap while the first is still running", async () => {
    // 双击提交是真实场景；setState 是异步的，光靠 pending 挡不住
    let release!: () => void;
    const action = jest.fn(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const { result } = await renderHook(() =>
      useAsyncAction(action, { failureMessage: "失败" }),
    );

    await act(async () => {
      result.current.run();
      result.current.run();
    });

    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
    });
  });

  it("stays quiet when the action's guard skipped the work", async () => {
    // 回归：action 里 `if (!x) return` 会让 hook 报"已完成"，其实什么都没做
    const { result } = await renderHook(() =>
      useAsyncAction(async () => false as const, {
        failureMessage: "失败",
        successMessage: "已保存",
      }),
    );

    await act(async () => {
      result.current.run();
    });

    expect(messages()).not.toContain("已保存");
  });

  it("only announces success when asked to", async () => {
    const { result } = await renderHook(() =>
      useAsyncAction(async () => {}, {
        failureMessage: "失败",
        successMessage: "已保存",
      }),
    );

    await act(async () => {
      result.current.run();
    });

    expect(messages()).toContain("已保存");
  });
});
