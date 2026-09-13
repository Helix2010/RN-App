import {
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { renderWithProviders } from "../test/harness";
import { LaunchScreen } from "./launch-screen";

/** Animated.View 渲染后 style 里是当前数值；transform 里 scale 同理 */
function contentStyle() {
  return StyleSheet.flatten(
    screen.getByTestId("launch-content").props.style,
  ) as {
    opacity: number;
    transform: { scale: number }[];
  };
}

describe("LaunchScreen animation start", () => {
  it("shows the content at once when the delivered animation is none, even after a pending first frame", async () => {
    // 首帧 pending 时不知道动画类型；Animated.Value 的起点必须在知道配置后重设
    await renderWithProviders(<LaunchScreen pending message="m" title="T" />);
    await screen.rerender(
      <LaunchScreen message="m" title="T" animationType="none" />,
    );

    expect(contentStyle().opacity).toBe(1);
    expect(contentStyle().transform[0]?.scale).toBe(1);
  });

  it("does not shrink the content for a plain fade", async () => {
    await renderWithProviders(<LaunchScreen pending message="m" title="T" />);
    await screen.rerender(
      <LaunchScreen message="m" title="T" animationType="fade" />,
    );

    expect(contentStyle().transform[0]?.scale).toBe(1);
  });

  it("keeps the logo and title above the background after the image loads", async () => {
    const asset = {
      assetId: "bg1",
      fileUrl: "https://cdn.test/bg.png",
    } as never;
    await renderWithProviders(
      <LaunchScreen
        message="m"
        title="T"
        animationType="none"
        logo={
          { assetId: "logo1", fileUrl: "https://cdn.test/logo.png" } as never
        }
        backgroundImage={asset}
      />,
    );
    expect(screen.getByTestId("launch-logo")).toBeTruthy();
    expect(screen.getByText("T")).toBeTruthy();
    await fireEvent(screen.getByTestId("launch-background"), "load");
    expect(screen.getByTestId("launch-logo")).toBeTruthy();
    expect(screen.getByText("T")).toBeTruthy();
    expect(screen.getByTestId("launch-scrim")).toBeTruthy();
  });

  it("keeps the logo visible when the background image is already cached locally", async () => {
    await renderWithProviders(
      <LaunchScreen
        message="m"
        title="T"
        animationType="none"
        logo={
          { assetId: "logo1", fileUrl: "https://cdn.test/logo.png" } as never
        }
        backgroundImage={
          {
            assetId: "bg1",
            fileUrl: "https://cdn.test/bg.png",
            localFileUrl: "file:///cache/bg.png",
          } as never
        }
      />,
    );
    expect(screen.getByTestId("launch-logo")).toBeTruthy();
    expect(screen.getByText("T")).toBeTruthy();
    expect(screen.getByTestId("launch-background")).toBeTruthy();
  });

  it("keeps the status line at the bottom instead of under the logo", async () => {
    await renderWithProviders(
      <LaunchScreen
        message="正在同步应用配置"
        title="T"
        animationType="none"
        logo={
          { assetId: "logo1", fileUrl: "https://cdn.test/logo.png" } as never
        }
      />,
    );

    // 文案不在淡入的那一块里：它说的是程序在干什么，不是品牌的一部分
    expect(
      within(screen.getByTestId("launch-content")).queryByText(
        "正在同步应用配置",
      ),
    ).toBeNull();
    const footer = screen.getByTestId("launch-message");
    expect(within(footer).getByText("正在同步应用配置")).toBeTruthy();
    expect(StyleSheet.flatten(footer.props.style).position).toBe("absolute");
  });

  it("puts the status line in the same place before the branding is known", async () => {
    // pending 那一帧和拿到配置之后位置必须一致，否则文字会跳一下
    await renderWithProviders(<LaunchScreen pending message="m" title="T" />);
    expect(
      within(screen.getByTestId("launch-pending")).queryByText("m"),
    ).toBeNull();
    expect(
      within(screen.getByTestId("launch-message")).getByText("m"),
    ).toBeTruthy();
  });

  it("handles background and logo failures independently", async () => {
    const background = {
      assetId: "bg1",
      fileUrl: "https://cdn.test/bg.png",
    } as never;
    const logo = {
      assetId: "logo1",
      fileUrl: "https://cdn.test/logo.png",
    } as never;
    await renderWithProviders(
      <LaunchScreen
        message="m"
        title="T"
        animationType="none"
        logo={logo}
        backgroundImage={background}
      />,
    );

    await fireEvent(screen.getByTestId("launch-logo"), "error");
    await waitFor(() => expect(screen.queryByTestId("launch-logo")).toBeNull());
    expect(screen.getByTestId("launch-background")).toBeTruthy();

    await fireEvent(screen.getByTestId("launch-background"), "error");
    await waitFor(() =>
      expect(screen.queryByTestId("launch-scrim")).toBeNull(),
    );
    expect(screen.getByText("T")).toBeTruthy();
  });
});
