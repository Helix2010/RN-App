import { bootstrapSchema } from "./bootstrap.schema";
import { createFallbackConfig } from "./fallback-config";

describe("bootstrapSchema", () => {
  it("accepts the embedded safe configuration", () => {
    const config = createFallbackConfig("zh-CN");
    const parsed = bootstrapSchema.safeParse(config);
    expect(parsed.success).toBe(true);
    expect(config.localization.messages["home.portfoliochange"]).toBe(
      "过去 24 小时 · 数据仅用于展示",
    );
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
