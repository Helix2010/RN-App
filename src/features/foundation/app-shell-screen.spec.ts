import { resolveAppShellBack } from "./app-shell-back";

describe("app shell back behavior", () => {
  it("consumes back on the home tab so Android does not background the app", () => {
    expect(resolveAppShellBack("home")).toBe("consume");
  });

  it.each(["assets", "profile"] as const)(
    "returns to home from the %s tab",
    (tab) => {
      expect(resolveAppShellBack(tab)).toBe("home");
    },
  );
});
