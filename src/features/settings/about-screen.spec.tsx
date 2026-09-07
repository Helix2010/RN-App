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

  // 关于页这一行以前把标题写死成"已是最新版本"，检查结果是"已下载待重启"时也没有文案，
  // 用户看到的永远是"已是最新版本"。现在标题是"检查更新"，值跟着运行时的 OTA 状态走
  it("shows a downloaded OTA as pending instead of up to date", async () => {
    const config = createFallbackConfig("zh-CN");
    config.update.decision = "none";
    const otaResult = {
      status: "ready" as const,
      messageKey: "update.otaReadyNextLaunch",
      metadata: {
        updateId: "update-pending",
        runtimeVersion: "1.2.9",
        channel: "production",
        isEmbedded: false,
        createdAt: null,
        applyStrategy: "next_launch" as const,
      },
    };
    const checkForUpdates = jest.fn(async () => ({
      kind: "ota" as const,
      snapshot: { config, source: "remote" as const, stale: false },
      result: otaResult,
    }));
    const { runtime } = await renderWithProviders(
      <AboutScreen navigation={fakeNavigation()} route={undefined as never} />,
      { config: () => config, runtime: { checkForUpdates, otaResult } },
    );

    expect(screen.getByText(runtime.t("settings.checkUpdate"))).toBeTruthy();
    expect(
      screen.getByText(runtime.t("update.otaReadyNextLaunch")),
    ).toBeTruthy();
    expect(screen.queryByText(runtime.t("settings.upToDate"))).toBeNull();

    await fireEvent.press(screen.getByTestId("about-check-update"));
    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(runtime.t("update.otaReadyNextLaunch")),
    ).toBeTruthy();
    expect(screen.queryByText(runtime.t("settings.upToDate"))).toBeNull();
  });
});
