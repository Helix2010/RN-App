import {
  EXIT_CONFIRM_WINDOW_MS,
  resolveAppShellBack,
  resolveExitAttempt,
} from "./app-shell-back";

describe("app shell back behavior", () => {
  it("consumes back on the home tab so Android does not background the app", () => {
    expect(resolveAppShellBack("home")).toBe("consume");
  });

  it.each(["predict", "positions", "dex", "market", "swap", "assets"] as const)(
    "returns to home from the %s tab",
    (tab) => {
      expect(resolveAppShellBack(tab)).toBe("home");
    },
  );
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
