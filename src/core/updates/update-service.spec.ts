import * as Updates from "expo-updates";
import { createFallbackConfig } from "../config/fallback-config";
import {
  checkAndDownloadOta,
  getManifestAppIdentity,
  getUpdateMetadataFromManifest,
  isManifestCompatibleWithApp,
} from "./update-service";

jest.mock("expo-updates", () => ({
  isEnabled: true,
  updateId: null,
  runtimeVersion: "test",
  channel: "development",
  isEmbeddedLaunch: true,
  createdAt: null,
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));

describe("update service feature flags", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns localization keys instead of hard-coded user messages", async () => {
    const config = createFallbackConfig("zh-CN");
    config.features.otaEnabled = false;

    await expect(checkAndDownloadOta(config)).resolves.toEqual({
      status: "embedded",
      messageKey: "update.otaDisabled",
      metadata: {
        updateId: null,
        runtimeVersion: "test",
        channel: "development",
        isEmbedded: true,
        createdAt: null,
        applyStrategy: "next_launch",
      },
    });
  });

  it("checks and downloads an available OTA", async () => {
    const config = createFallbackConfig("zh-CN");
    config.features.otaEnabled = true;
    config.update.ota.enabled = true;
    config.update.ota.channel = "development";
    config.update.ota.runtimeVersion = "test";
    config.update.ota.applyStrategy = "immediate";
    const manifest = {
      id: "update-1",
      runtimeVersion: "test",
      createdAt: "2026-08-28T00:00:00.000Z",
      metadata: { applyStrategy: "next_launch" },
      extra: {
        appVersion: config.app.version,
        buildNumber: config.app.buildNumber,
      },
    };
    (Updates.checkForUpdateAsync as jest.Mock).mockResolvedValue({
      isAvailable: true,
      manifest,
    });
    (Updates.fetchUpdateAsync as jest.Mock).mockResolvedValue({
      isNew: true,
      manifest,
    });

    const transitions: string[] = [];
    await expect(
      checkAndDownloadOta(config, {
        onStateChange: (state) => transitions.push(state),
      }),
    ).resolves.toEqual({
      status: "ready",
      messageKey: "update.otaReadyImmediate",
      metadata: expect.objectContaining({
        runtimeVersion: "test",
        channel: "development",
        isEmbedded: false,
        applyStrategy: "immediate",
      }),
    });
    expect(transitions).toEqual([
      "checking",
      "available",
      "downloading",
      "ready",
    ]);
  });

  it("reads immediate apply strategy from an Expo manifest extra payload", () => {
    const metadata = getUpdateMetadataFromManifest({
      id: "update-extra",
      runtimeVersion: "test",
      extra: { metadata: { applyStrategy: "immediate" } },
    });

    expect(metadata.applyStrategy).toBe("immediate");
  });

  it("uses the tenant Bootstrap strategy when the native manifest omits it", async () => {
    const config = createFallbackConfig("zh-CN");
    config.features.otaEnabled = true;
    config.update.ota.enabled = true;
    config.update.ota.channel = "development";
    config.update.ota.runtimeVersion = "test";
    config.update.ota.applyStrategy = "immediate";
    const manifest = {
      id: "update-bootstrap-policy",
      runtimeVersion: "test",
      createdAt: "2026-08-28T00:00:00.000Z",
      extra: {
        appVersion: config.app.version,
        buildNumber: config.app.buildNumber,
      },
    };
    (Updates.checkForUpdateAsync as jest.Mock).mockResolvedValue({
      isAvailable: true,
      manifest,
    });
    (Updates.fetchUpdateAsync as jest.Mock).mockResolvedValue({
      isNew: true,
      manifest,
    });

    await expect(checkAndDownloadOta(config)).resolves.toEqual(
      expect.objectContaining({
        status: "ready",
        messageKey: "update.otaReadyImmediate",
        metadata: expect.objectContaining({ applyStrategy: "immediate" }),
      }),
    );
  });

  it("does not contact OTA when Bootstrap targets another runtime", async () => {
    const config = createFallbackConfig("zh-CN");
    config.features.otaEnabled = true;
    config.update.ota.enabled = true;
    config.update.ota.channel = "development";
    config.update.ota.channel = "development";
    config.update.ota.runtimeVersion = "other-runtime";

    await expect(checkAndDownloadOta(config)).resolves.toEqual(
      expect.objectContaining({
        status: "embedded",
        messageKey: "update.otaIncompatible",
      }),
    );
    expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
  });

  it("rejects an OTA built for another APK version before download", async () => {
    const config = createFallbackConfig("zh-CN");
    config.features.otaEnabled = true;
    config.update.ota.enabled = true;
    config.update.ota.channel = "development";
    config.update.ota.runtimeVersion = "test";
    (Updates.checkForUpdateAsync as jest.Mock).mockResolvedValue({
      isAvailable: true,
      manifest: {
        id: "old-apk-ota",
        runtimeVersion: "test",
        extra: { appVersion: "1.1.7", buildNumber: "11" },
      },
    });

    await expect(checkAndDownloadOta(config)).resolves.toEqual(
      expect.objectContaining({
        status: "embedded",
        messageKey: "update.otaIncompatible",
      }),
    );
    expect(Updates.fetchUpdateAsync).not.toHaveBeenCalled();
  });

  it("matches nested Expo client identity for the current APK", () => {
    const config = createFallbackConfig("zh-CN");
    config.app.buildNumber = "42";

    const manifest = {
      extra: {
        expoClient: {
          version: config.app.version,
          android: { versionCode: Number(config.app.buildNumber) },
        },
      },
    };
    expect(getManifestAppIdentity(manifest)).toEqual({
      version: config.app.version,
      buildNumber: config.app.buildNumber,
    });
    expect(isManifestCompatibleWithApp(manifest, config)).toBe(true);
  });

  it("surfaces a rollback directive without blocking the app", async () => {
    const config = createFallbackConfig("zh-CN");
    config.features.otaEnabled = true;
    config.update.ota.enabled = true;
    config.update.ota.channel = "development";
    config.update.ota.runtimeVersion = "test";
    (Updates.checkForUpdateAsync as jest.Mock).mockResolvedValue({
      isAvailable: false,
      isRollBackToEmbedded: true,
    });
    (Updates.fetchUpdateAsync as jest.Mock).mockResolvedValue({
      isNew: false,
      isRollBackToEmbedded: true,
    });

    await expect(checkAndDownloadOta(config)).resolves.toEqual(
      expect.objectContaining({
        status: "rollback",
        messageKey: "update.otaRollback",
      }),
    );
  });

  it("coalesces a background check and a manual check", async () => {
    const config = createFallbackConfig("zh-CN");
    config.features.otaEnabled = true;
    config.update.ota.enabled = true;
    config.update.ota.channel = "development";
    config.update.ota.runtimeVersion = "test";
    let resolveCheck: ((value: { isAvailable: false }) => void) | undefined;
    (Updates.checkForUpdateAsync as jest.Mock).mockImplementation(
      () => new Promise((resolve) => (resolveCheck = resolve)),
    );

    const first = checkAndDownloadOta(config);
    const second = checkAndDownloadOta(config);
    expect(Updates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    resolveCheck?.({ isAvailable: false });
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
  });
});
