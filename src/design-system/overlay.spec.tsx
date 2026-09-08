import { act, screen } from "@testing-library/react-native";
import { BackHandler, Text } from "react-native";
import { renderWithProviders } from "../test/harness";
import {
  FullScreenOverlay,
  blockingLoading,
  useBlockingLoading,
} from "./overlay";
import { toast } from "./toast";

type BackHandlerListener = () => boolean | null | undefined;

function LoadingProbe() {
  useBlockingLoading(true, "登录中…");
  return null;
}

/** 模拟系统返回键：与 BackHandler 一致，后注册的先响应，第一个返回 true 的吃掉事件 */
function pressBack(listeners: BackHandlerListener[]): boolean {
  for (const listener of [...listeners].reverse()) {
    if (listener()) return true;
  }
  return false;
}

describe("OverlayLayer", () => {
  it("renders full-screen overlay content in the root layer and answers Android back", async () => {
    // RN 0.86 的 jest 预设没有 mockPressBack，直接抓注册的返回键处理函数
    const listeners: BackHandlerListener[] = [];
    const spy = jest
      .spyOn(BackHandler, "addEventListener")
      .mockImplementation((_event, handler) => {
        listeners.push(handler as unknown as BackHandlerListener);
        return { remove: jest.fn() };
      });
    const onRequestClose = jest.fn();
    try {
      await renderWithProviders(
        <FullScreenOverlay
          visible
          onRequestClose={onRequestClose}
          testID="demo-overlay"
        >
          <Text>覆盖层内容</Text>
        </FullScreenOverlay>,
      );
      expect(screen.getByTestId("demo-overlay")).toBeTruthy();
      expect(screen.getByText("覆盖层内容")).toBeTruthy();

      expect(pressBack(listeners)).toBe(true);
      expect(onRequestClose).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("does not render anything while the overlay is hidden", async () => {
    await renderWithProviders(
      <FullScreenOverlay visible={false} testID="demo-overlay">
        <Text>不该出现</Text>
      </FullScreenOverlay>,
    );
    expect(screen.queryByTestId("demo-overlay")).toBeNull();
    expect(screen.queryByText("不该出现")).toBeNull();
  });

  it("shows blocking loading with its label, keeps toasts above it and hides on unmount", async () => {
    await renderWithProviders(<LoadingProbe />);
    expect(screen.getByTestId("blocking-loading")).toBeTruthy();
    expect(screen.getByText("登录中…")).toBeTruthy();

    await act(async () => {
      toast("已复制", "success");
    });
    // loading 遮罩带 accessibilityViewIsModal，RNTL 默认会把它的兄弟节点当作对读屏隐藏
    expect(
      screen.getByText("已复制", { includeHiddenElements: true }),
    ).toBeTruthy();
    // toast 在 loading 之后渲染 => 画在它上面
    const layer = screen.getByTestId("overlay-layer");
    const children = layer.children.filter(
      (child) => typeof child !== "string",
    );
    const loadingIndex = children.findIndex(
      (child) =>
        typeof child !== "string" && child.props.testID === "blocking-loading",
    );
    expect(loadingIndex).toBeGreaterThanOrEqual(0);
    expect(loadingIndex).toBeLessThan(children.length - 1);

    await screen.unmount();
    await renderWithProviders(<Text>下一页</Text>);
    expect(screen.queryByTestId("blocking-loading")).toBeNull();
  });

  it("keeps the loading mask while any imperative caller is still busy", async () => {
    await renderWithProviders(<Text>页面</Text>);
    let first = () => {};
    let second = () => {};
    await act(async () => {
      first = blockingLoading.show("第一个");
      second = blockingLoading.show();
    });
    expect(screen.getByTestId("blocking-loading")).toBeTruthy();
    expect(screen.getByText("第一个")).toBeTruthy();

    await act(async () => {
      first();
    });
    expect(screen.getByTestId("blocking-loading")).toBeTruthy();
    await act(async () => {
      second();
    });
    // 重复 release 不能把别人的遮罩收掉
    await act(async () => {
      second();
    });
    expect(screen.queryByTestId("blocking-loading")).toBeNull();
  });
});
