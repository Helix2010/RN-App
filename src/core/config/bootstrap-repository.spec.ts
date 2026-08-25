import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiClient } from "../network/api-client";
import { loadBootstrap } from "./bootstrap-repository";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock("../network/api-client", () => ({
  apiClient: { get: jest.fn() },
  appRuntime: {
    version: "1.0.0",
    buildNumber: "1",
    platform: "android",
    distributionChannel: "development",
    runtimeVersion: "test",
  },
}));

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const getBootstrap = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

describe("loadBootstrap", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("falls back and removes a corrupted cache when the server is unavailable", async () => {
    getBootstrap.mockRejectedValue(new Error("server unavailable"));
    storage.getItem.mockResolvedValue("{broken-json");

    const snapshot = await loadBootstrap("zh-CN");

    expect(snapshot.source).toBe("fallback");
    expect(snapshot.stale).toBe(true);
    expect(snapshot.config.localization.fallbackLocale).toBe("zh-CN");
    expect(storage.removeItem).toHaveBeenCalledWith(
      "foundation.bootstrap.v1.zh-CN",
    );
  });
});
