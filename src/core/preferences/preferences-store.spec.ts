import { migratePreferences } from "./preferences-store";

describe("migratePreferences", () => {
  // 以前的默认值就是 "system"，分不清是不是用户主动选的：按默认值迁到租户的回退语言
  it("moves the old follow-system default to the tenant default language", () => {
    expect(
      migratePreferences(
        { locale: "system", theme: "dark", txVerification: "always" },
        2,
      ),
    ).toEqual({ locale: "default", theme: "dark", txVerification: "always" });
  });

  it("keeps a language the user picked", () => {
    expect(
      migratePreferences({ locale: "en-US", txVerification: "smart" }, 2),
    ).toEqual({ locale: "en-US", txVerification: "smart" });
  });

  it("still upgrades the v1 transaction confirmation switch", () => {
    expect(
      migratePreferences({ locale: "system", txConfirm: false }, 1),
    ).toEqual({ locale: "default", txVerification: "off" });
  });

  it("leaves current state alone", () => {
    expect(migratePreferences({ locale: "system" }, 3)).toEqual({
      locale: "system",
    });
  });
});
