import AsyncStorage from "@react-native-async-storage/async-storage";
import { createFallbackConfig } from "../config/fallback-config";
import { apiClient, appRuntime } from "../network/api-client";
import {
  heartbeatFingerprint,
  syncInstallationHeartbeat,
} from "./installation-service";

const mockSecureStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "afterFirstUnlockThisDeviceOnly",
  getItemAsync: jest.fn(
    async (key: string) => mockSecureStore.get(key) ?? null,
  ),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
}));
jest.mock("expo-application", () => ({
  applicationId: "com.anyfun.foundation",
  getAndroidId: () => "android-id",
  getIosIdForVendorAsync: async () => null,
  getIosPushNotificationServiceEnvironmentAsync: async () => null,
}));
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  randomUUID: () => "0123456789abcdef0123456789abcdef",
  digestStringAsync: async () => "a".repeat(64),
}));
jest.mock("expo-notifications", () => ({}));
jest.mock("../network/api-client", () => ({
  apiClient: { post: jest.fn() },
  appRuntime: {
    version: "1.2.4",
    buildNumber: "18",
    platform: "android",
    distributionChannel: "direct",
    otaChannel: "production",
    runtimeVersion: "1.2.4",
    apiBaseUrl: "https://api.example.com",
    applicationId: "dex-mobile",
  },
}));

const post = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const runtime = appRuntime as { version: string; buildNumber: string };
const config = createFallbackConfig("zh-CN");
const iso = "2026-09-01T00:00:00.000Z";

function answerRequests(): void {
  post.mockImplementation(async (path: string) => {
    if (path.endsWith("/register")) {
      return {
        installationId: "inst_0123456789abcdef0123456789abcdef",
        installationCredential: "icred_test",
        credentialVersion: 1,
        credentialExpiresAt: iso,
        heartbeatIntervalSeconds: 1800,
        receivedAt: iso,
      };
    }
    return {
      installationId: "inst_0123456789abcdef0123456789abcdef",
      heartbeatIntervalSeconds: 1800,
      receivedAt: iso,
      credentialVersion: 1,
      credentialExpiresAt: iso,
    };
  });
}

function calledPaths(): string[] {
  return post.mock.calls.map(([path]) => path);
}

describe("syncInstallationHeartbeat", () => {
  beforeEach(async () => {
    mockSecureStore.clear();
    await AsyncStorage.clear();
    post.mockReset();
    answerRequests();
    runtime.version = "1.2.4";
    runtime.buildNumber = "18";
    jest.useFakeTimers({ now: new Date("2026-09-01T03:00:00Z") });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("registers once, then throttles identical reports for 30 minutes", async () => {
    await syncInstallationHeartbeat(config, "system");
    expect(calledPaths()).toEqual([
      "/v1/mobile/installations/register",
      "/v1/mobile/installations/heartbeat",
    ]);
    jest.setSystemTime(new Date("2026-09-01T03:20:00Z"));
    await syncInstallationHeartbeat(config, "system");
    expect(post).toHaveBeenCalledTimes(2);
    jest.setSystemTime(new Date("2026-09-01T03:31:00Z"));
    await syncInstallationHeartbeat(config, "system");
    expect(calledPaths()).toHaveLength(3);
    expect(calledPaths()[2]).toBe("/v1/mobile/installations/heartbeat");
  });

  it("heartbeats immediately after the native build changes", async () => {
    await syncInstallationHeartbeat(config, "system");
    runtime.version = "1.2.5";
    runtime.buildNumber = "19";
    jest.setSystemTime(new Date("2026-09-01T03:01:00Z"));
    await syncInstallationHeartbeat(config, "system");
    expect(calledPaths()).toEqual([
      "/v1/mobile/installations/register",
      "/v1/mobile/installations/heartbeat",
      "/v1/mobile/installations/heartbeat",
    ]);
    const [, , third] = post.mock.calls;
    expect(third?.[3]).toEqual({
      headers: { Authorization: "Installation icred_test" },
    });
  });

  it("heartbeats immediately when reported metadata changes", async () => {
    await syncInstallationHeartbeat(config, "system");
    jest.setSystemTime(new Date("2026-09-01T03:01:00Z"));
    await syncInstallationHeartbeat(config, "dark");
    expect(post).toHaveBeenCalledTimes(3);
    expect(post.mock.calls[2]?.[1]).toMatchObject({ theme: "dark" });
    await syncInstallationHeartbeat(config, "dark");
    expect(post).toHaveBeenCalledTimes(3);
  });

  it("changes the fingerprint for build and metadata but not identity fields", () => {
    const base = {
      installationId: "inst_a",
      deviceSourceHash: "a".repeat(64),
      packageId: "com.anyfun.foundation",
      otaChannel: "production",
      otaRevision: null,
      localizationVersion: "1",
      brandingVersion: 2,
      locale: "zh-CN",
      theme: "system" as const,
      osVersion: "36",
      deviceClass: "android-phone",
    };
    const fingerprint = heartbeatFingerprint(base);
    expect(heartbeatFingerprint({ ...base, installationId: "inst_b" })).toBe(
      fingerprint,
    );
    expect(heartbeatFingerprint({ ...base, otaRevision: 3 })).not.toBe(
      fingerprint,
    );
    runtime.buildNumber = "19";
    expect(heartbeatFingerprint(base)).not.toBe(fingerprint);
  });
});
