import * as Updates from "expo-updates";
import { rememberCanaryToken, resetCanaryTokenCache } from "./canary-token";

jest.mock("expo-updates", () => ({
  isEnabled: true,
  setExtraParamAsync: jest.fn(),
}));

const updates = Updates as unknown as {
  isEnabled: boolean;
  setExtraParamAsync: jest.Mock;
};

describe("canary token", () => {
  beforeEach(() => {
    resetCanaryTokenCache();
    updates.isEnabled = true;
    updates.setExtraParamAsync.mockReset();
    updates.setExtraParamAsync.mockResolvedValue(undefined);
  });

  // 键必须全小写：expo-structured-headers 拒绝大写键，manifest 请求会在原生侧抛异常
  it("writes the token under a lowercase structured-field key", async () => {
    await rememberCanaryToken("tok-1");
    expect(updates.setExtraParamAsync).toHaveBeenCalledWith(
      "canary-token",
      "tok-1",
    );
    const [key] = updates.setExtraParamAsync.mock.calls[0] as [string, string];
    expect(key).toBe(key.toLowerCase());
  });

  it("clears the stored token when the server no longer issues one", async () => {
    await rememberCanaryToken("tok-1");
    await rememberCanaryToken(null);
    expect(updates.setExtraParamAsync).toHaveBeenLastCalledWith(
      "canary-token",
      null,
    );
  });

  it("does not touch native storage when the value is unchanged", async () => {
    await rememberCanaryToken("tok-1");
    await rememberCanaryToken("tok-1");
    expect(updates.setExtraParamAsync).toHaveBeenCalledTimes(1);
  });

  it("stays silent when updates are disabled", async () => {
    updates.isEnabled = false;
    await rememberCanaryToken("tok-1");
    expect(updates.setExtraParamAsync).not.toHaveBeenCalled();
  });

  // 开发构建会直接抛；灰度是附加能力，不能因此影响启动
  it("swallows native failures and retries on the next value", async () => {
    updates.setExtraParamAsync.mockRejectedValueOnce(
      new Error("NotAvailableInDevClient"),
    );
    await expect(rememberCanaryToken("tok-1")).resolves.toBeUndefined();
    await rememberCanaryToken("tok-1");
    expect(updates.setExtraParamAsync).toHaveBeenCalledTimes(2);
  });
});
