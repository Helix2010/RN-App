import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiClient } from "../network/api-client";
import { loadBootstrap } from "./bootstrap-repository";
import { createFallbackConfig } from "./fallback-config";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock("../network/api-client", () => ({
  apiClient: { get: jest.fn(), getText: jest.fn() },
  appRuntime: {
    version: "1.0.0",
    buildNumber: "1",
    platform: "android",
    distributionChannel: "development",
    runtimeVersion: "test",
    apiBaseUrl: "https://tenant-a.example.com",
    applicationId: "dex-mobile",
  },
}));
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  CryptoEncoding: { HEX: "hex" },
  digestStringAsync: jest.fn(),
}));

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const getBootstrap = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const getLanguage = apiClient.getText as jest.MockedFunction<
  typeof apiClient.getText
>;

describe("loadBootstrap", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("blocks startup and removes a corrupted cache when the server is unavailable", async () => {
    getBootstrap.mockRejectedValue(new Error("server unavailable"));
    storage.getItem.mockResolvedValue("{broken-json");

    await expect(loadBootstrap("zh-CN")).rejects.toThrow("server unavailable");
    expect(storage.removeItem).toHaveBeenCalledWith(
      "foundation.bootstrap.v3.https%3A%2F%2Ftenant-a.example.com.dex-mobile.zh-CN",
    );
  });

  it("uses the request domain and writes only the domain-scoped cache", async () => {
    const config = createFallbackConfig("en-US");
    getBootstrap.mockResolvedValue(config);

    const snapshot = await loadBootstrap("en-US");

    expect(snapshot.source).toBe("remote");
    expect(getBootstrap).toHaveBeenCalledWith(
      "/v1/mobile/bootstrap?locale=en-US",
      expect.anything(),
      { signal: undefined },
    );
    expect(storage.setItem).toHaveBeenCalledWith(
      "foundation.bootstrap.v3.https%3A%2F%2Ftenant-a.example.com.dex-mobile.en-US",
      expect.any(String),
    );
  });

  it("uses a validated remote language package when one is published", async () => {
    const Crypto = jest.requireMock("expo-crypto") as {
      digestStringAsync: jest.Mock;
    };
    const config = createFallbackConfig("zh-CN");
    const text = JSON.stringify({
      schemaVersion: 1,
      tenantId: "100000001",
      languageCode: "zh-CN",
      version: "2",
      generatedAt: "2026-08-26T00:00:00.000Z",
      messages: { "app.name": "远程名称" },
    });
    config.localization.resource = {
      version: "2",
      objectKey: "localization/test.json",
      fileUrl: "/v1/mobile/languages/zh-CN/document?v=2",
      sha256: "abc",
      size: new Blob([text]).size,
      publishedAt: "2026-08-26T00:00:00.000Z",
    };
    getBootstrap.mockResolvedValue(config);
    getLanguage.mockResolvedValue({
      text,
      headers: new Headers({ "x-content-sha256": "abc" }),
    });
    Crypto.digestStringAsync.mockResolvedValue("abc");
    storage.getItem.mockResolvedValue(null);

    const snapshot = await loadBootstrap("zh-CN");

    expect(snapshot.config.localization.messages["app.name"]).toBe("远程名称");
    expect(snapshot.config.localization.messages["settings.title"]).toBe(
      "设置",
    );
    expect(snapshot.config.localization.messagesVersion).toBe("2");
  });

  it("keeps the server-reported newer APK update in the fresh snapshot", async () => {
    const config = createFallbackConfig("zh-CN");
    config.app.version = "1.1.2";
    config.app.buildNumber = "6";
    config.app.distribution = "direct";
    config.update.decision = "recommended";
    config.update.latestVersion = "1.1.5";
    config.update.full = {
      channel: "direct",
      actionUrl:
        "https://api.anyfun.win/v1/public/releases/rel_latest/download",
      releaseId: "rel_latest",
      sha256: "b".repeat(64),
      size: 96_565_418,
    };
    config.update.ota.applyStrategy = null;
    getBootstrap.mockResolvedValue(config);

    const snapshot = await loadBootstrap("zh-CN");

    expect(snapshot.source).toBe("remote");
    expect(snapshot.stale).toBe(false);
    expect(snapshot.config.update.decision).toBe("recommended");
    expect(snapshot.config.update.latestVersion).toBe("1.1.5");
    expect(snapshot.config.update.full.releaseId).toBe("rel_latest");
  });
});
