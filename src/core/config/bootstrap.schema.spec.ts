import { bootstrapSchema } from "./bootstrap.schema";
import { createFallbackConfig } from "./fallback-config";

describe("bootstrapSchema", () => {
  it("accepts the embedded safe configuration", () => {
    const parsed = bootstrapSchema.safeParse(createFallbackConfig("zh-CN"));
    expect(parsed.success).toBe(true);
  });

  it("rejects arbitrary remote theme values", () => {
    const config = createFallbackConfig("zh-CN");
    config.theme.dark.primary = "url(javascript:unsafe)";
    expect(bootstrapSchema.safeParse(config).success).toBe(false);
  });
});
