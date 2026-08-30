import { mockHomeData, mockText } from ".";

describe("demo data localization", () => {
  it("selects the requested mock-data locale", () => {
    expect(mockText(mockHomeData.notice, "zh-CN")).toContain("世界杯");
    expect(mockText(mockHomeData.notice, "en-US")).toContain("World Cup");
  });

  it("falls back to English for a locale without mock copy", () => {
    expect(mockText(mockHomeData.notice, "ja-JP")).toBe(
      mockHomeData.notice["en-US"],
    );
  });
});
