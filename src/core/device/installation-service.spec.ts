import AsyncStorage from "@react-native-async-storage/async-storage";
import { createFallbackConfig } from "../config/fallback-config";
import { apiClient, appRuntime } from "../network/api-client";
import {
  notifySessionStateChanged,
  setSessionStateProbe,
} from "./session-state-probe";
import {
  ensureInstallationAuthorization,
  forgetInstallationCredential,
  forgetInstallationSyncInputForTests,
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
// babel 的 namespace import 会在导入时拷贝模块属性，直接改对象字段测试看不到；
// 用 getter 让每次读取都回到这份可变状态
const mockUpdatesState = {
  isEnabled: true,
  updateId: null as string | null,
  isEmbeddedLaunch: true,
};
jest.mock("expo-updates", () => ({
  get isEnabled() {
    return mockUpdatesState.isEnabled;
  },
  get updateId() {
    return mockUpdatesState.updateId;
  },
  get isEmbeddedLaunch() {
    return mockUpdatesState.isEmbeddedLaunch;
  },
  runtimeVersion: "1.2.4",
  channel: "production",
  createdAt: null,
}));
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
const runtime = appRuntime as {
  version: string;
  buildNumber: string;
  applicationId: string;
};
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
    mockUpdatesState.isEnabled = true;
    mockUpdatesState.isEmbeddedLaunch = true;
    mockUpdatesState.updateId = null;
    setSessionStateProbe(null);
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

  // 设计 §4.1：内置包报 embedded 且不带 update id；OTA 包报 ota 并带正在运行的 update id；
  // OTA 生效后的第一次启动指纹必须变化，立刻上报，不能等 30 分钟
  it("reports the running bundle and heartbeats as soon as an OTA takes effect", async () => {
    await syncInstallationHeartbeat(config, "system");
    expect(post.mock.calls[1]?.[1]).toMatchObject({
      launchSource: "embedded",
      runningUpdateId: null,
      sessionState: null,
    });
    mockUpdatesState.isEmbeddedLaunch = false;
    mockUpdatesState.updateId = "7c5c1363-8685-42b2-864e-38b6790471ca";
    jest.setSystemTime(new Date("2026-09-01T03:01:00Z"));
    await syncInstallationHeartbeat(config, "system");
    expect(post).toHaveBeenCalledTimes(3);
    expect(post.mock.calls[2]?.[1]).toMatchObject({
      launchSource: "ota",
      runningUpdateId: "7c5c1363-8685-42b2-864e-38b6790471ca",
    });
  });

  it("treats a build without expo-updates as the embedded bundle", async () => {
    mockUpdatesState.isEnabled = false;
    mockUpdatesState.isEmbeddedLaunch = false;
    await syncInstallationHeartbeat(config, "system");
    expect(post.mock.calls[1]?.[1]).toMatchObject({
      launchSource: "embedded",
      runningUpdateId: null,
    });
  });

  // 登录态只给服务端对账：探针注册后随心跳上报，状态翻转时指纹变化立即再报
  it("reports the client session state from the registered probe", async () => {
    let state: "signed_in" | "signed_out" = "signed_out";
    setSessionStateProbe(async () => state);
    await syncInstallationHeartbeat(config, "system");
    expect(post.mock.calls[1]?.[1]).toMatchObject({
      sessionState: "signed_out",
    });
    state = "signed_in";
    notifySessionStateChanged();
    jest.setSystemTime(new Date("2026-09-01T03:01:00Z"));
    await syncInstallationHeartbeat(config, "system");
    expect(post).toHaveBeenCalledTimes(3);
    expect(post.mock.calls[2]?.[1]).toMatchObject({
      sessionState: "signed_in",
    });
  });

  // 登录必须带安装身份：凭证没了就当场重新注册；启动心跳还没跑过就明确失败，不退化成无关联登录
  it("re-registers on demand for sign-in and fails loudly before the first heartbeat", async () => {
    forgetInstallationSyncInputForTests();
    await expect(ensureInstallationAuthorization()).rejects.toMatchObject({
      code: "INSTALLATION_REQUIRED",
    });
    await syncInstallationHeartbeat(config, "system");
    expect(await ensureInstallationAuthorization()).toEqual({
      "X-Installation-ID": "inst_0123456789abcdef0123456789abcdef",
      Authorization: "Installation icred_test",
    });
    await forgetInstallationCredential();
    const headers = await ensureInstallationAuthorization();
    expect(headers.Authorization).toBe("Installation icred_test");
    expect(
      calledPaths().filter((path) => path.endsWith("/register")),
    ).toHaveLength(2);
  });

  it("changes the fingerprint for build and metadata but not identity fields", () => {
    const base = {
      installationId: "inst_a",
      deviceSourceHash: "a".repeat(64),
      packageId: "com.anyfun.foundation",
      otaChannel: "production",
      otaRevision: null,
      launchSource: "embedded" as const,
      runningUpdateId: null,
      sessionState: null,
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
    const rebuilt = heartbeatFingerprint(base);
    expect(rebuilt).not.toBe(fingerprint);
    runtime.applicationId = "com.anyfun.foundation";
    expect(heartbeatFingerprint(base)).not.toBe(rebuilt);
    runtime.applicationId = "dex-mobile";
  });
});
