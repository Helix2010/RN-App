import {
  buildAppTabs,
  defaultAppTab,
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

  /**
   * Wallet-only（00）：没有业务模块时首页和资产讲的是同一件事，所以壳层
   * 直接以资产为主页，另外两格给记录与我的——而不是留两个内容重复的页签。
   */
  it("builds the wallet-only shell when neither module is enabled", () => {
    expect(
      buildAppTabs({ predict: false, dex: false }).map(({ key }) => key),
    ).toEqual(["assets", "records", "profile"]);
  });

  it("makes assets the main tab in wallet-only and home elsewhere", () => {
    expect(defaultAppTab({ predict: false, dex: false })).toBe("assets");
    expect(defaultAppTab({ predict: true, dex: true })).toBe("home");
    expect(defaultAppTab({ predict: true, dex: false })).toBe("home");
    expect(defaultAppTab({ predict: false, dex: true })).toBe("home");
  });

  it("drops the home tab in wallet-only so the shell never renders a tab that is not there", () => {
    expect(isAppContentAvailable("home", { predict: false, dex: false })).toBe(
      false,
    );
    expect(isAppContentAvailable("home", { predict: true, dex: false })).toBe(
      true,
    );
  });

  it("keeps records and profile out of the shell whenever a module is enabled", () => {
    for (const modules of [
      { predict: true, dex: true },
      { predict: true, dex: false },
      { predict: false, dex: true },
    ]) {
      expect(isAppContentAvailable("records", modules)).toBe(false);
      expect(isAppContentAvailable("profile", modules)).toBe(false);
    }
    expect(
      isAppContentAvailable("records", { predict: false, dex: false }),
    ).toBe(true);
    expect(
      isAppContentAvailable("profile", { predict: false, dex: false }),
    ).toBe(true);
  });

  it("keeps every business content unreachable in wallet-only", () => {
    const off = { predict: false, dex: false };
    for (const tab of [
      "predict",
      "positions",
      "dex",
      "market",
      "swap",
    ] as const)
      expect(isAppContentAvailable(tab, off)).toBe(false);
  });
});
