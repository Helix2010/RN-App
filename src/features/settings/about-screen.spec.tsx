import { fireEvent, screen } from "@testing-library/react-native";
import { createFallbackConfig } from "../../core/config/fallback-config";
import { fakeNavigation, renderWithProviders } from "../../test/harness";
import { AboutScreen } from "./about-screen";

describe("AboutScreen", () => {
  it("checks updates in place and exposes deduplicated version information", async () => {
    const navigation = fakeNavigation();
    const config = createFallbackConfig("zh-CN");
    config.app.version = "1.2.2";
    config.app.buildNumber = "16";
    config.update.minSupportedVersion = "0.9.0";
    config.update.latestVersion = "1.2.2";
    const checkForUpdates = jest.fn(async () => ({
      kind: "none" as const,
      snapshot: { config, source: "remote" as const, stale: false },
    }));
    await renderWithProviders(
      <AboutScreen navigation={navigation} route={undefined as never} />,
      { config: () => config, runtime: { checkForUpdates } },
    );

    await fireEvent.press(screen.getByTestId("about-check-update"));
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    expect(navigation.navigate).not.toHaveBeenCalledWith("UpdateCenter");

    await fireEvent.press(screen.getByTestId("about-changelog"));
    expect(screen.getAllByText("版本信息").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("1.2.2 (16)")).toBeTruthy();
    expect(screen.getByText("0.9.0")).toBeTruthy();
  });
});
