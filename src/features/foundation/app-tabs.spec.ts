import {
  buildAppTabs,
  isAppContentAvailable,
  resolveBottomTab,
} from "./app-tabs";

describe("tenant module tab configuration", () => {
  it("builds Predict and DEX tabs when both modules are enabled", () => {
    expect(
      buildAppTabs({ predict: true, dex: true }).map(({ key }) => key),
    ).toEqual(["home", "predict", "dex", "assets"]);
  });

  it("promotes positions when only Predict is enabled", () => {
    expect(
      buildAppTabs({ predict: true, dex: false }).map(({ key }) => key),
    ).toEqual(["home", "predict", "positions", "assets"]);
  });

  it("promotes markets and swap when only DEX is enabled", () => {
    expect(
      buildAppTabs({ predict: false, dex: true }).map(({ key }) => key),
    ).toEqual(["home", "market", "swap", "assets"]);
  });

  it("keeps nested module views under their combined-module bottom tab", () => {
    const modules = { predict: true, dex: true };
    expect(resolveBottomTab("positions", modules)).toBe("predict");
    expect(resolveBottomTab("swap", modules)).toBe("dex");
  });

  it("rejects content from a disabled module", () => {
    expect(
      isAppContentAvailable("predict", { predict: false, dex: true }),
    ).toBe(false);
    expect(isAppContentAvailable("swap", { predict: true, dex: false })).toBe(
      false,
    );
  });
});
