import { changeLocalePreference, requestLocale } from "./locale-change";

describe("language preference transaction", () => {
  it("stages and validates the target Bootstrap before committing", async () => {
    const calls: string[] = [];

    await changeLocalePreference({
      preference: "en-US",
      currentPreference: "zh-CN",
      deviceLocale: "zh-CN",
      stage: async (locale) => {
        calls.push(`stage:${locale ?? "default"}`);
      },
      commit: (preference) => calls.push(`commit:${preference}`),
    });

    expect(calls).toEqual(["stage:en-US", "commit:en-US"]);
  });

  it("keeps the current preference when target Bootstrap staging fails", async () => {
    const commit = jest.fn();

    await expect(
      changeLocalePreference({
        preference: "en-US",
        currentPreference: "zh-CN",
        deviceLocale: "zh-CN",
        stage: async () => {
          throw new Error("remote Bootstrap unavailable");
        },
        commit,
      }),
    ).rejects.toThrow("remote Bootstrap unavailable");

    expect(commit).not.toHaveBeenCalled();
  });

  it("stages the tenant default without a language when switching back to it", async () => {
    const calls: string[] = [];

    await changeLocalePreference({
      preference: "default",
      currentPreference: "en-US",
      deviceLocale: "en-US",
      stage: async (locale) => {
        calls.push(`stage:${locale ?? "default"}`);
      },
      commit: (preference) => calls.push(`commit:${preference}`),
    });

    expect(calls).toEqual(["stage:default", "commit:default"]);
  });
});

describe("requestLocale", () => {
  it("leaves the default language to the tenant's fallback language on the server", () => {
    expect(requestLocale("default", "ja-JP")).toBeNull();
  });

  it("hands the device language to the server when following the system", () => {
    expect(requestLocale("system", "ja-JP")).toBe("ja-JP");
    expect(requestLocale("system", null)).toBeNull();
  });

  it("uses a language the user picked", () => {
    expect(requestLocale("en-US", "zh-CN")).toBe("en-US");
  });
});
