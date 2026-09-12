import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  HDNodeWallet,
  encodeBase64,
  getBytes,
  toUtf8Bytes,
} from "ethers";
import { apiClient, appRuntime } from "../network/api-client";
import { BOOTSTRAP_SIGNATURE_ALGORITHM } from "./bootstrap-signature";
import {
  loadBootstrap,
  loadCachedBootstrap,
  MAX_CACHE_ENTRY_AGE_MS,
} from "./bootstrap-repository";
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
    // 可变：验签的用例要按租户开关它
    bootstrapSignerAddress: "",
  },
}));
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  CryptoEncoding: { HEX: "hex" },
  digestStringAsync: jest.fn(),
}));
jest.mock("../device/installation-service", () => ({
  installationAuthorization: jest.fn(async () => ({})),
}));
jest.mock("../updates/canary-token", () => ({
  rememberCanaryToken: jest.fn(async () => undefined),
}));

const { installationAuthorization } = jest.requireMock(
  "../device/installation-service",
) as { installationAuthorization: jest.Mock };
const { rememberCanaryToken } = jest.requireMock("../updates/canary-token") as {
  rememberCanaryToken: jest.Mock;
};
const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const getText = apiClient.getText as jest.MockedFunction<
  typeof apiClient.getText
>;

/**
 * bootstrap 现在走 getText：验签验的是收到的原始字节，必须在 JSON.parse 之前
 * 拿到手。语言包也走 getText，所以这里按路径分派，两条路互不干扰。
 */
type TextResponse = { text: string; headers: Headers };
let bootstrapResponse: (() => Promise<TextResponse>) | null = null;
let languageResponse: (() => Promise<TextResponse>) | null = null;

function bootstrapReturns(config: unknown, headers: Record<string, string> = {}) {
  bootstrapResponse = async () => ({
    text: typeof config === "string" ? config : JSON.stringify(config),
    headers: new Headers(headers),
  });
}
function bootstrapFails(error: Error) {
  bootstrapResponse = () => Promise.reject(error);
}
const getBootstrap = {
  mockResolvedValue: bootstrapReturns,
  mockRejectedValue: bootstrapFails,
};
const getLanguage = {
  mockResolvedValue: (value: TextResponse) => {
    languageResponse = async () => value;
  },
  mockRejectedValue: (error: Error) => {
    languageResponse = () => Promise.reject(error);
  },
};

function installTextDispatcher() {
  bootstrapResponse = null;
  languageResponse = null;
  getText.mockImplementation(async (path: string) => {
    if (path.startsWith("/v1/mobile/bootstrap")) {
      if (!bootstrapResponse) throw new Error("no bootstrap response configured");
      return bootstrapResponse();
    }
    if (!languageResponse) throw new Error("no language response configured");
    return languageResponse();
  });
}

describe("loadBootstrap", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    installTextDispatcher();
    installationAuthorization.mockResolvedValue({});
  });

  // 灰度靠"服务端签发的安装凭证"识别身份，不是裸的安装 ID（设计 §8.1）
  it("sends the installation credential so the server can match a canary release", async () => {
    installationAuthorization.mockResolvedValue({
      "X-Installation-ID": "inst_1",
      Authorization: "Installation icred_abc",
    });
    getBootstrap.mockResolvedValue(createFallbackConfig("zh-CN"));

    await loadBootstrap("zh-CN");

    expect(getText).toHaveBeenCalledWith(
      expect.stringContaining("/v1/mobile/bootstrap"),
      expect.objectContaining({
        headers: {
          "X-Installation-ID": "inst_1",
          Authorization: "Installation icred_abc",
        },
      }),
    );
  });

  it("hands the canary token to expo-updates and keeps it out of the cache", async () => {
    const config = createFallbackConfig("zh-CN");
    getBootstrap.mockResolvedValue({
      ...config,
      update: {
        ...config.update,
        canary: { enrolled: true, otaToken: "canary-tok" },
      },
    });

    await loadBootstrap("zh-CN");

    expect(rememberCanaryToken).toHaveBeenCalledWith("canary-tok");
    const [, cached] = storage.setItem.mock.calls.at(-1) as [string, string];
    expect(cached).not.toContain("canary-tok");
    expect(JSON.parse(cached).config.update.canary).toEqual({
      enrolled: true,
      otaToken: null,
    });
  });

  // 服务端认不出身份时不下发令牌，客户端要把旧的清掉，否则过期令牌会一直带着
  it("clears the stored token when the server issues none", async () => {
    getBootstrap.mockResolvedValue(createFallbackConfig("zh-CN"));

    await loadBootstrap("zh-CN");

    expect(rememberCanaryToken).toHaveBeenCalledWith(null);
  });

  it("blocks startup when the server is unavailable, whatever the cache holds", async () => {
    getBootstrap.mockRejectedValue(new Error("server unavailable"));
    storage.getItem.mockResolvedValue("{broken-json");

    await expect(loadBootstrap("zh-CN")).rejects.toThrow("server unavailable");
  });

  it("removes a corrupted cache when the launch screen reads it", async () => {
    // 缓存只在启动页决定画哪版品牌时读；坏掉的缓存在这里被清掉，而不是拿来冒充配置
    storage.getItem.mockResolvedValue("{broken-json");

    await expect(loadCachedBootstrap("zh-CN")).resolves.toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(
      "foundation.bootstrap.v3.https%3A%2F%2Ftenant-a.example.com.dex-mobile.zh-CN",
    );
  });

  it("does not hand out a cached snapshot when the server is unavailable", async () => {
    // loadBootstrap 只回答"这次下发到了吗"。要不要退回缓存是上一层（use-bootstrap）
    // 的决定，这里不替它做，也就不会有"以为是远程、其实是缓存"的快照流出去。
    getBootstrap.mockRejectedValue(new Error("server unavailable"));
    storage.getItem.mockResolvedValue(
      JSON.stringify({
        savedAt: Date.now(),
        config: createFallbackConfig("zh-CN"),
      }),
    );

    await expect(loadBootstrap("zh-CN")).rejects.toThrow("server unavailable");
  });

  it("withholds a cache older than the caller's window without discarding it", async () => {
    // 放行业务页只认一天内的下发；但那份缓存画启动页品牌还有用，不能顺手清掉
    storage.getItem.mockResolvedValue(
      JSON.stringify({
        savedAt: Date.now() - MAX_CACHE_ENTRY_AGE_MS - 1_000,
        config: createFallbackConfig("zh-CN"),
      }),
    );

    await expect(
      loadCachedBootstrap("zh-CN", MAX_CACHE_ENTRY_AGE_MS),
    ).resolves.toBeNull();
    expect(storage.removeItem).not.toHaveBeenCalled();
    await expect(loadCachedBootstrap("zh-CN")).resolves.not.toBeNull();
  });

  it("hands out a cache inside the caller's window", async () => {
    storage.getItem.mockResolvedValue(
      JSON.stringify({
        savedAt: Date.now() - 60_000,
        config: createFallbackConfig("zh-CN"),
      }),
    );

    await expect(
      loadCachedBootstrap("zh-CN", MAX_CACHE_ENTRY_AGE_MS),
    ).resolves.not.toBeNull();
  });

  it("uses the request domain and writes only the domain-scoped cache", async () => {
    const config = createFallbackConfig("en-US");
    getBootstrap.mockResolvedValue(config);

    const snapshot = await loadBootstrap("en-US");

    expect(snapshot.source).toBe("remote");
    expect(getText).toHaveBeenCalledWith("/v1/mobile/bootstrap?locale=en-US", {
      signal: undefined,
      timeoutMs: 15_000,
      headers: {},
    });
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

  it("refuses a language package that belongs to another tenant", async () => {
    const Crypto = jest.requireMock("expo-crypto") as {
      digestStringAsync: jest.Mock;
    };
    const config = createFallbackConfig("zh-CN");
    const text = JSON.stringify({
      schemaVersion: 1,
      tenantId: "999999999",
      languageCode: "zh-CN",
      version: "2",
      generatedAt: "2026-08-26T00:00:00.000Z",
      messages: { "app.name": "别家的名称" },
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
    // 本机此前认定的租户是 100000001
    storage.getItem.mockImplementation(async (key: string) =>
      key.endsWith(".tenant") ? "100000001" : null,
    );

    const snapshot = await loadBootstrap("zh-CN");

    // 整套文案被换掉会连金额单位和风险提示一起换掉，宁可退回内置文案（安全评审 N27）
    expect(snapshot.config.localization.messages["app.name"]).not.toBe(
      "别家的名称",
    );
    expect(
      storage.setItem.mock.calls.some(([key]) =>
        String(key).includes("foundation.language.v2"),
      ),
    ).toBe(false);
  });

  it("does not fall back to a cached package from another tenant either", async () => {
    const Crypto = jest.requireMock("expo-crypto") as {
      digestStringAsync: jest.Mock;
    };
    const config = createFallbackConfig("zh-CN");
    const foreign = JSON.stringify({
      schemaVersion: 1,
      tenantId: "999999999",
      languageCode: "zh-CN",
      version: "1",
      generatedAt: "2026-08-26T00:00:00.000Z",
      messages: { "app.name": "别家的名称" },
    });
    config.localization.resource = {
      version: "2",
      objectKey: "localization/test.json",
      fileUrl: "/v1/mobile/languages/zh-CN/document?v=2",
      sha256: "abc",
      size: 10,
      publishedAt: "2026-08-26T00:00:00.000Z",
    };
    getBootstrap.mockResolvedValue(config);
    // 下载失败 → 走缓存回退；缓存里存的是别家租户的包
    getLanguage.mockRejectedValue(new Error("offline"));
    Crypto.digestStringAsync.mockResolvedValue("abc");
    storage.getItem.mockImplementation(async (key: string) =>
      key.endsWith(".tenant") ? "100000001" : foreign,
    );

    const snapshot = await loadBootstrap("zh-CN");

    expect(snapshot.config.localization.messages["app.name"]).not.toBe(
      "别家的名称",
    );
  });

  it("pins the tenant of the first language package it accepts", async () => {
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

    await loadBootstrap("zh-CN");

    expect(storage.setItem).toHaveBeenCalledWith(
      expect.stringContaining(".tenant"),
      "100000001",
    );
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
    expect(snapshot.config.update.decision).toBe("recommended");
    expect(snapshot.config.update.latestVersion).toBe("1.1.5");
    expect(snapshot.config.update.full.releaseId).toBe("rel_latest");
  });
});

describe("bootstrap 响应验签（N3）", () => {
  const wallet = HDNodeWallet.createRandom();
  const runtime = appRuntime as { bootstrapSignerAddress: string };

  async function signed(body: string): Promise<Record<string, string>> {
    const signature = await wallet.signMessage(toUtf8Bytes(body));
    return {
      "x-bootstrap-signature": `sig="${encodeBase64(getBytes(signature))}", keyid="main", alg="${BOOTSTRAP_SIGNATURE_ALGORITHM}"`,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    installTextDispatcher();
    installationAuthorization.mockResolvedValue({});
    storage.getItem.mockResolvedValue(null);
    runtime.bootstrapSignerAddress = wallet.address;
  });

  afterAll(() => {
    runtime.bootstrapSignerAddress = "";
  });

  it("接受钉住的那把密钥签的下发", async () => {
    const body = JSON.stringify({
      ...createFallbackConfig("zh-CN"),
      issuedAt: 1_700_000_000_000,
    });
    bootstrapReturns(body, await signed(body));

    await expect(loadBootstrap("zh-CN")).resolves.toMatchObject({
      source: "remote",
    });
  });

  it("响应体被改过就拒绝——哪怕只改了一个字节", async () => {
    const body = JSON.stringify(createFallbackConfig("zh-CN"));
    const headers = await signed(body);
    bootstrapReturns(body.replace('"zh-CN"', '"en-US"'), headers);

    await expect(loadBootstrap("zh-CN")).rejects.toThrow(
      /bootstrap signature rejected/,
    );
  });

  it("别的密钥签的也拒绝", async () => {
    const body = JSON.stringify(createFallbackConfig("zh-CN"));
    const attacker = HDNodeWallet.createRandom();
    const signature = await attacker.signMessage(toUtf8Bytes(body));
    bootstrapReturns(body, {
      "x-bootstrap-signature": `sig="${encodeBase64(getBytes(signature))}", keyid="main", alg="${BOOTSTRAP_SIGNATURE_ALGORITHM}"`,
    });

    await expect(loadBootstrap("zh-CN")).rejects.toThrow(/signed by/);
  });

  // 2026-09-12 起强制：配了签名者地址的租户，没有签名就不启动
  it("配了签名者地址却收到没签名的下发，拒绝", async () => {
    bootstrapReturns(createFallbackConfig("zh-CN"));

    await expect(loadBootstrap("zh-CN")).rejects.toThrow(/did not sign/);
  });

  it("租户没配签名者地址时根本不验", async () => {
    runtime.bootstrapSignerAddress = "";
    bootstrapReturns(createFallbackConfig("zh-CN"));

    await expect(loadBootstrap("zh-CN")).resolves.toMatchObject({
      source: "remote",
    });
  });

  it("重放一份更旧的合法下发会被拒——签名挡不住回滚更新策略", async () => {
    storage.getItem.mockImplementation(async (key: string) =>
      key.includes("issued-at") ? String(1_700_000_000_000) : null,
    );
    const body = JSON.stringify({
      ...createFallbackConfig("zh-CN"),
      issuedAt: 1_600_000_000_000,
    });
    bootstrapReturns(body, await signed(body));

    await expect(loadBootstrap("zh-CN")).rejects.toThrow(/replayed/);
  });

  it("记住见过的最大 issuedAt", async () => {
    const body = JSON.stringify({
      ...createFallbackConfig("zh-CN"),
      issuedAt: 1_800_000_000_000,
    });
    bootstrapReturns(body, await signed(body));

    await loadBootstrap("zh-CN");

    expect(storage.setItem).toHaveBeenCalledWith(
      expect.stringContaining("issued-at"),
      "1800000000000",
    );
  });
});
