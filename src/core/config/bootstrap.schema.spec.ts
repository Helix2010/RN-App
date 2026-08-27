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
  });
});
