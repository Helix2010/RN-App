/* global describe, it, expect */

const {
  injectProductionAutolinking,
} = require("./with-production-android-optimizations");

describe("production Android optimization plugin", () => {
  it("injects Dev Client exclusions before Expo autolinking", () => {
    const result = injectProductionAutolinking(
      "plugins {}\nexpoAutolinking.useExpoModules()\n",
    );

    expect(result).toContain("expoAutolinking.exclude");
    expect(result.indexOf("expoAutolinking.exclude")).toBeLessThan(
      result.indexOf("expoAutolinking.useExpoModules()"),
    );
  });

  it("is idempotent", () => {
    const initial = injectProductionAutolinking(
      "expoAutolinking.useExpoModules()\n",
    );

    expect(injectProductionAutolinking(initial)).toBe(initial);
  });
});
