import { resolveSystemBack } from "./system-back";

describe("system back routing", () => {
  it("navigates out of secondary screens", () => {
    expect(resolveSystemBack("Settings", true, false)).toBe("navigate");
    expect(resolveSystemBack("UpdateCenter", true, false)).toBe("navigate");
  });

  it("consumes back for a locked required update", () => {
    expect(resolveSystemBack("UpdateCenter", false, true)).toBe("consume");
  });

  it("lets AppShell own tab and home behavior", () => {
    expect(resolveSystemBack("AppShell", true, false)).toBe("bubble");
  });
});
