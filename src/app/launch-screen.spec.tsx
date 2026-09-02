import { screen } from "@testing-library/react-native";
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
});
