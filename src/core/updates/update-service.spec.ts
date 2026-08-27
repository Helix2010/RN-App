import * as Linking from "expo-linking";
import * as Updates from "expo-updates";
import { createFallbackConfig } from "../config/fallback-config";
import { checkAndDownloadOta, openFullUpdate } from "./update-service";

jest.mock("expo-linking", () => ({
  canOpenURL: jest.fn(),
  openURL: jest.fn(),
}));

jest.mock("expo-updates", () => ({
  isEnabled: true,
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));

describe("update service feature flags", () => {
  it("returns localization keys instead of hard-coded user messages", async () => {
    const config = createFallbackConfig("zh-CN");
    config.features.otaEnabled = false;

    await expect(checkAndDownloadOta(config)).resolves.toEqual({
      status: "disabled",
      messageKey: "update.otaDisabled",
    });
  });

  it("blocks Android direct installation when the feature is disabled", async () => {
    const config = createFallbackConfig("zh-CN");
    config.app.platform = "android";
    config.app.distribution = "direct";
    config.features.directUpdateEnabled = false;
    config.update.full.actionUrl = "https://api.example.com/app.apk";

    await expect(openFullUpdate(config)).resolves.toBe(false);
    expect(Linking.canOpenURL).not.toHaveBeenCalled();
  });

  it("checks and downloads an available OTA", async () => {
    const config = createFallbackConfig("zh-CN");
    config.features.otaEnabled = true;
    config.update.ota.enabled = true;
    (Updates.checkForUpdateAsync as jest.Mock).mockResolvedValue({
      isAvailable: true,
    });
    (Updates.fetchUpdateAsync as jest.Mock).mockResolvedValue({ isNew: true });

    await expect(checkAndDownloadOta(config)).resolves.toEqual({
      status: "ready",
      messageKey: "update.otaReady",
    });
  });
});
