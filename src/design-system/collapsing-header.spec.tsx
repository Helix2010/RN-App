import { fireEvent, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { renderWithProviders } from "../test/harness";
import {
  CollapseAnchor,
  CollapsingHeader,
  headerProgress,
} from "./collapsing-header";

describe("headerProgress", () => {
  it("stays 0 until the anchor is measured, then ramps over the last 24px before the threshold", () => {
    expect(headerProgress(500, -1)).toBe(0);
    expect(headerProgress(0, 100)).toBe(0);
    expect(headerProgress(76, 100)).toBe(0);
    expect(headerProgress(88, 100)).toBeCloseTo(0.5);
    expect(headerProgress(100, 100)).toBe(1);
    expect(headerProgress(400, 100)).toBe(1);
    // 细线用更短的距离
    expect(headerProgress(96, 100, 8)).toBeCloseTo(0.5);
  });
});

describe("CollapsingHeader", () => {
  it("renders the expanded middle and keeps the compact copy hidden from assistive tech", async () => {
    await renderWithProviders(
      <CollapsingHeader
        onBack={() => {}}
        backLabel="返回"
        expanded={<Text>POLITICS</Text>}
        collapsed={<Text>Will BTC hit 120k?</Text>}
        actions={<Text>★</Text>}
      >
        <Text>hero</Text>
        <CollapseAnchor />
        <Text>body</Text>
      </CollapsingHeader>,
    );
    expect(screen.getByText("POLITICS")).toBeTruthy();
    expect(screen.getByLabelText("返回")).toBeTruthy();
    // 紧凑标题只是滚走内容的复本：默认查询（不含隐藏元素）找不到它
    expect(screen.queryByText("Will BTC hit 120k?")).toBeNull();
    expect(
      screen.getByText("Will BTC hit 120k?", { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(screen.getByTestId("collapse-anchor")).toBeTruthy();
  });

  it("in floating mode shows no bar until there is something to pin, and hides the bar from assistive tech", async () => {
    await renderWithProviders(
      <CollapsingHeader mode="floating">
        <Text>title row</Text>
        <CollapseAnchor />
      </CollapsingHeader>,
    );
    expect(screen.queryByTestId("collapsing-bar")).toBeNull();
    await screen.unmount();
    await renderWithProviders(
      <CollapsingHeader mode="floating" collapsed={<Text>chips</Text>}>
        <Text>title row</Text>
        <CollapseAnchor />
      </CollapsingHeader>,
    );
    expect(screen.queryByText("chips")).toBeNull();
    expect(
      screen.getByText("chips", { includeHiddenElements: true }),
    ).toBeTruthy();
    // 状态栏垫层始终挂着（透明度随滚动），不拦手势
    expect(
      screen.getByTestId("collapsing-status-strip").props.pointerEvents,
    ).toBe("none");
  });

  it("keeps the default content spacing when a page only sets paddingTop", async () => {
    await renderWithProviders(
      <CollapsingHeader
        mode="floating"
        contentProps={{ paddingTop: 40 }}
        testID="scroll"
      >
        <Text>a</Text>
        <Text>b</Text>
      </CollapsingHeader>,
    );
    const style = flatten(screen.getByTestId("collapsing-content").props.style);
    // 显式 undefined 曾把 styled 默认的 gap / paddingBottom 抹掉，首页各区块就贴在一起了
    expect(style.paddingTop).toBe(40);
    expect(style.gap).toBeGreaterThan(0);
    expect(style.paddingBottom).toBeGreaterThan(0);
  });
  it("reports end reached from drag end and momentum end when near the bottom", async () => {
    const onEndReached = jest.fn();
    await renderWithProviders(
      <CollapsingHeader onEndReached={onEndReached} testID="scroll">
        <Text>content</Text>
      </CollapsingHeader>,
    );
    const nearBottom = {
      nativeEvent: {
        contentOffset: { y: 900 },
        contentSize: { height: 1500, width: 0 },
        layoutMeasurement: { height: 400, width: 0 },
      },
    };
    const farAway = {
      nativeEvent: {
        contentOffset: { y: 0 },
        contentSize: { height: 5000, width: 0 },
        layoutMeasurement: { height: 400, width: 0 },
      },
    };
    await fireEvent(screen.getByTestId("scroll"), "scrollEndDrag", farAway);
    expect(onEndReached).not.toHaveBeenCalled();
    await fireEvent(screen.getByTestId("scroll"), "scrollEndDrag", nearBottom);
    await fireEvent(
      screen.getByTestId("scroll"),
      "momentumScrollEnd",
      nearBottom,
    );
    expect(onEndReached).toHaveBeenCalledTimes(2);
  });
});

function flatten(style: unknown): Record<string, number> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flatten));
  return (style ?? {}) as Record<string, number>;
}
