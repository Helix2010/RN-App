import { resolveApiBaseUrl, resolveRuntimeVersion } from "./runtime-config";

describe("runtime API configuration", () => {
  it("normalizes an explicitly packaged tenant API URL", () => {
    expect(resolveApiBaseUrl("https://api.anyfun.win/")).toBe(
      "https://api.anyfun.win",
    );
  });

  it("fails closed instead of silently using localhost", () => {
    expect(resolveApiBaseUrl(undefined)).toBeNull();
    expect(resolveApiBaseUrl("")).toBeNull();
  });

  it("removes trailing whitespace from native runtime metadata before headers", () => {
    expect(resolveRuntimeVersion("1.1.9\n")).toBe("1.1.9");
    expect(resolveRuntimeVersion(undefined)).toBe("embedded");
  });
});
