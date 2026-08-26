import { normalizeMessages, translateMessage } from "./localization";

describe("localization key normalization", () => {
  it("normalizes stored keys and camel-case lookups to lowercase", () => {
    const messages = normalizeMessages({
      "Action.CheckUpdate": "检查更新",
    });

    expect(messages).toEqual({ "action.checkupdate": "检查更新" });
    expect(translateMessage(messages, " action.CheckUpdate ")).toBe("检查更新");
  });

  it("returns the normalized key when a message is missing", () => {
    expect(translateMessage({}, "Wallet.Connect")).toBe("wallet.connect");
  });
});
