import { bootstrapSchema, predictServiceSchema } from "./bootstrap.schema";
import { createFallbackConfig } from "./fallback-config";
import { platformHosts } from "../predict-platform/tenant-client";

describe("bootstrapSchema", () => {
  it("accepts the embedded safe configuration", () => {
    const config = createFallbackConfig("zh-CN");
    const parsed = bootstrapSchema.safeParse(config);
    expect(parsed.success).toBe(true);
    expect(config.localization.localeCatalog?.[0]).toEqual({
      code: "zh-CN",
      label: "简体中文",
      nativeName: "中文",
    });
  });

  it("requires the config refresh interval instead of picking one itself", () => {
    // 运营改了链 / 币 / 端点后多久生效，必须是管理端能看见的值；
    // 客户端自己挑一个数字，管理端那个输入框就成了不起作用的摆设
    const config = createFallbackConfig("zh-CN");
    const without = { ...config, localization: { ...config.localization } };
    delete (without.localization as { refreshIntervalSeconds?: number })
      .refreshIntervalSeconds;
    expect(bootstrapSchema.safeParse(without).success).toBe(false);
  });

  it("rejects arbitrary remote theme values", () => {
    const config = createFallbackConfig("zh-CN");
    config.theme.dark.primary = "url(javascript:unsafe)";
    expect(bootstrapSchema.safeParse(config).success).toBe(false);
    config.theme.dark.primary = "#AFC6FF";
  });

  it("accepts dynamic branding languages without a fixed locale enum", () => {
    const config = createFallbackConfig("zh-CN");
    if (!config.branding) throw new Error("fallback branding is missing");
    config.branding.selectedLocale = "ja-JP";
    config.branding.fallbackLocale = "en-US";
    config.branding.launch.visuals.light.logo = {
      assetId: "brand_ja",
      objectKey: "tenants/1/branding/brand_ja.png",
      fileUrl: "/v1/mobile/branding/assets/brand_ja",
      fileName: "brand_ja.png",
      mimeType: "image/png",
      size: 1024,
      sha256: "a".repeat(64),
      width: 512,
      height: 512,
    };
    expect(bootstrapSchema.safeParse(config).success).toBe(true);
  });

  it("accepts a dynamic locale catalog with display labels", () => {
    const config = createFallbackConfig("zh-CN");
    config.localization.supportedLocales.push("ja-JP");
    config.localization.localeCatalog?.push({
      code: "ja-JP",
      label: "日语",
      nativeName: "日本語",
    });

    const parsed = bootstrapSchema.safeParse(config);

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.localization.localeCatalog?.at(-1)).toEqual({
      code: "ja-JP",
      label: "日语",
      nativeName: "日本語",
    });
  });

  it("accepts per-service predict endpoints only as https/wss base URLs and derives the rest", () => {
    const base = {
      domain: "predict.prax1s.xyz",
      scopeId: `0x${"ab".repeat(32)}`,
      chain: "op-sepolia",
    };
    const ok = predictServiceSchema.safeParse({
      ...base,
      endpoints: {
        clob: "https://clob.example.net:8443/api",
        clobWs: "wss://ws.example.net",
      },
    });
    expect(ok.success).toBe(true);
    if (!ok.success) return;
    // 没覆盖的按域名派生，覆盖的原样用
    expect(platformHosts(ok.data)).toMatchObject({
      gamma: "https://gamma-api.predict.prax1s.xyz",
      clob: "https://clob.example.net:8443/api",
      clobWs: "wss://ws.example.net",
    });
    for (const endpoints of [
      { gamma: "http://gamma.example.net" },
      { clobWs: "https://ws.example.net" },
      { data: "https://data.example.net/?x=1" },
      { relayer: "https://relayer.example.net/" },
      { faucet: "faucet.example.net" },
    ]) {
      expect(
        predictServiceSchema.safeParse({ ...base, endpoints }).success,
      ).toBe(false);
    }
  });

  it("requires at least one tenant business module", () => {
    const config = createFallbackConfig("zh-CN");
    config.modules = { predict: false, dex: false };
    expect(bootstrapSchema.safeParse(config).success).toBe(false);
  });

  it("accepts a full update response when no OTA apply strategy is active", () => {
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
      sha256: "a".repeat(64),
      size: 96_565_418,
    };
    config.update.ota.applyStrategy = null;

    const parsed = bootstrapSchema.safeParse(config);

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.update.latestVersion).toBe("1.1.5");
    expect(parsed.data.update.full.releaseId).toBe("rel_latest");
  });
});

describe("bootstrapSchema wallet tokens", () => {
  const delivered = {
    chain: "bsc" as const,
    address: "0x55d398326f99059fF775485246999027B3197955",
    symbol: "USDT",
    name: "Tether USD",
    decimals: 18,
    displayDecimals: 2,
    logoColor: "#26A17B",
  };

  it("rejects a wallet section that omits the catalogue or the networks", () => {
    // 这段和服务端同步发布：缺一项就是整份 bootstrap 无效，运行时继续用上次的快照
    const config = createFallbackConfig("zh-CN");
    for (const wallet of [
      { walletConnectProjectId: "", onchainSends: false, networks: [] },
      { walletConnectProjectId: "", onchainSends: false, tokens: [] },
      { walletConnectProjectId: "", networks: [], tokens: [] },
    ]) {
      expect(bootstrapSchema.safeParse({ ...config, wallet }).success).toBe(
        false,
      );
    }
  });

  it("accepts the delivered token shape verbatim, with every field required", () => {
    const config = createFallbackConfig("zh-CN");
    const parsed = bootstrapSchema.safeParse({
      ...config,
      wallet: { ...config.wallet, tokens: [delivered] },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.wallet.tokens[0]).toEqual(delivered);

    // name / logoColor 不是可省略的：服务端写入时就要求它们
    for (const partial of [
      { ...delivered, name: undefined },
      { ...delivered, logoColor: undefined },
      { ...delivered, logoColor: "" },
      { ...delivered, logoColor: "red" },
    ]) {
      expect(
        bootstrapSchema.safeParse({
          ...config,
          wallet: { ...config.wallet, tokens: [partial] },
        }).success,
      ).toBe(false);
    }
  });

  it("rejects the whole bootstrap when a token is outside the protocol range", () => {
    // 服务端在写入时就拒绝这些值；出现在下发里只能是数据坏了——不丢一行继续，整份拒绝
    const config = createFallbackConfig("zh-CN");
    const parseWith = (token: object) =>
      bootstrapSchema.safeParse({
        ...config,
        wallet: { ...config.wallet, tokens: [delivered, token] },
      });
    for (const bad of [
      { ...delivered, decimals: 37 },
      { ...delivered, decimals: 1.5 },
      { ...delivered, symbol: "" },
      { ...delivered, chain: "polygon" },
    ]) {
      expect(parseWith(bad).success).toBe(false);
    }
  });
});
