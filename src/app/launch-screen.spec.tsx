import { fireEvent, screen } from "@testing-library/react-native";
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

  it("shows the logo until the background image has loaded, then only the background", async () => {
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
    expect(screen.queryByTestId("launch-logo")).toBeNull();
    expect(screen.queryByText("T")).toBeNull();
  });

  it("skips the logo entirely when the background image is already cached locally", async () => {
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
    expect(screen.queryByTestId("launch-logo")).toBeNull();
    expect(screen.getByTestId("launch-background")).toBeTruthy();
  });
});
