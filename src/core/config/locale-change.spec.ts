import {
  changeLocalePreference,
  resolveLocalePreference,
} from "./locale-change";

describe("language preference transaction", () => {
  it("stages and validates the target Bootstrap before committing", async () => {
    const calls: string[] = [];

    await changeLocalePreference({
      preference: "en-US",
      currentPreference: "zh-CN",
      systemLocale: "zh-CN",
      stage: async (locale) => {
        calls.push(`stage:${locale}`);
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
        systemLocale: "zh-CN",
        stage: async () => {
          throw new Error("remote Bootstrap unavailable");
        },
        commit,
      }),
    ).rejects.toThrow("remote Bootstrap unavailable");

    expect(commit).not.toHaveBeenCalled();
  });

  it("resolves system preference without persisting a guessed language", () => {
    expect(resolveLocalePreference("system", "ja-JP")).toBe("ja-JP");
  });
});
