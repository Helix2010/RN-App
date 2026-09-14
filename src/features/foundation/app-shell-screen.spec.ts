import {
  EXIT_CONFIRM_WINDOW_MS,
  resolveAppShellBack,
  resolveExitAttempt,
} from "./app-shell-back";

describe("app shell back behavior", () => {
  it("consumes back on the main tab so Android does not background the app", () => {
    expect(resolveAppShellBack("home", "home")).toBe("consume");
  });

  it.each(["predict", "positions", "dex", "market", "swap", "assets"] as const)(
    "returns to the main tab from the %s tab",
    (tab) => {
      expect(resolveAppShellBack(tab, "home")).toBe("home");
    },
  );

  /**
   * Wallet-only（00）下没有 home 页签，主页签是资产。返回必须回到资产，
   * 而不是回到一个底栏上不存在的页面。
   */
  it("uses assets as the main tab when no business module is enabled", () => {
    expect(resolveAppShellBack("assets", "assets")).toBe("consume");
    expect(resolveAppShellBack("records", "assets")).toBe("assets");
    expect(resolveAppShellBack("profile", "assets")).toBe("assets");
  });
});

describe("exit confirmation on the home tab", () => {
  it("only hints the first time and exits on a second attempt inside the window", () => {
    expect(resolveExitAttempt(null, 10_000)).toBe("hint");
    expect(resolveExitAttempt(10_000, 10_000 + EXIT_CONFIRM_WINDOW_MS)).toBe(
      "exit",
    );
  });

  it("starts over when the second attempt comes too late", () => {
    expect(
      resolveExitAttempt(10_000, 10_000 + EXIT_CONFIRM_WINDOW_MS + 1),
    ).toBe("hint");
  });
});
