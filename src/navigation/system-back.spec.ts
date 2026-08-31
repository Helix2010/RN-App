import { resolveSystemBack } from "./system-back";

describe("system back routing", () => {
  it("navigates out of secondary screens", () => {
    expect(resolveSystemBack("Settings", true, false)).toBe("navigate");
    expect(resolveSystemBack("Profile", true, false)).toBe("navigate");
  });

  it("consumes back for a locked required update", () => {
    expect(resolveSystemBack("AppShell", false, true)).toBe("consume");
  });

  it("lets AppShell own tab and home behavior", () => {
    expect(resolveSystemBack("AppShell", true, false)).toBe("bubble");
  });
});
