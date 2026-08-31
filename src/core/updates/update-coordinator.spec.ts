import { createFallbackConfig } from "../config/fallback-config";
import { resolveUpdatePlan } from "./update-coordinator";

describe("update coordinator", () => {
  it("prioritizes a full update over OTA", () => {
    const config = createFallbackConfig("zh-CN");
    config.update.decision = "required";
    config.update.full.actionUrl = "https://example.test/app.apk";
    config.features.otaEnabled = true;
    config.update.ota.enabled = true;
    expect(resolveUpdatePlan(config)).toBe("full");
  });

  it("selects OTA when there is no full update candidate", () => {
    const config = createFallbackConfig("zh-CN");
    config.features.otaEnabled = true;
    config.update.ota.enabled = true;
    expect(resolveUpdatePlan(config)).toBe("ota");
  });

  it("does not create an unusable full-update plan without an action URL", () => {
    const config = createFallbackConfig("zh-CN");
    config.update.decision = "required";
    config.update.full.actionUrl = null;
    expect(resolveUpdatePlan(config)).toBe("none");
  });
});
