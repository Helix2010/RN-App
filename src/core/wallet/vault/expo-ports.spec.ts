import * as SecureStore from "expo-secure-store";

import {
  PREDICT_KEYCHAIN_SERVICE,
  expoPredictSecureStore,
  expoSecureStore,
  expoSecureStoreIn,
  expoAuthenticatedSecureStore,
} from "./expo-ports";

jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "afterFirstUnlockThisDeviceOnly",
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  canUseBiometricAuthentication: jest.fn(() => true),
}));

const getItem = jest.mocked(SecureStore.getItemAsync);
const setItem = jest.mocked(SecureStore.setItemAsync);
const deleteItem = jest.mocked(SecureStore.deleteItemAsync);

beforeEach(() => {
  jest.clearAllMocks();
  getItem.mockResolvedValue(null);
  setItem.mockResolvedValue(undefined);
  deleteItem.mockResolvedValue(undefined);
});

describe("secure store ports", () => {
  it("keeps predict credentials in their own keychain service", async () => {
    await expoPredictSecureStore.set("k", "v");
    await expoPredictSecureStore.get("k");
    await expoPredictSecureStore.remove("k");
    // 钱包私钥和平台凭证共用命名空间时，任一侧的清理都会波及另一侧（安全评审 N21）
    expect(setItem).toHaveBeenCalledWith(
      "k",
      "v",
      expect.objectContaining({ keychainService: PREDICT_KEYCHAIN_SERVICE }),
    );
    expect(getItem).toHaveBeenCalledWith("k", {
      keychainService: PREDICT_KEYCHAIN_SERVICE,
    });
    expect(deleteItem).toHaveBeenCalledWith("k", {
      keychainService: PREDICT_KEYCHAIN_SERVICE,
    });
  });

  it("leaves the wallet vault in the default space so existing entries stay readable", async () => {
    await expoSecureStore.set("k", "v");
    await expoSecureStore.get("k");
    expect(setItem.mock.calls[0]?.[2]).not.toHaveProperty("keychainService");
    expect(getItem).toHaveBeenCalledWith("k", undefined);
  });

  it("always pins the accessibility class to this device", async () => {
    await expoSecureStoreIn("svc").set("k", "v");
    expect(setItem.mock.calls[0]?.[2]).toMatchObject({
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  });
});

describe("绑定用户认证的安全存储（A 路）", () => {
  const store = expoAuthenticatedSecureStore("解锁钱包");

  it("读写都要求系统验证——这正是它和普通 SecureStore 的全部区别", async () => {
    await store.set("wk", "value");
    await store.get("wk");

    expect(setItem).toHaveBeenCalledWith(
      "wk",
      "value",
      expect.objectContaining({ requireAuthentication: true }),
    );
    expect(getItem).toHaveBeenCalledWith(
      "wk",
      expect.objectContaining({ requireAuthentication: true }),
    );
  });

  // Android 上认证条目和非认证条目是两个不同的 keystore 别名，必须分开命名空间，
  // 否则"打开 requireAuthentication"会变成静默换钥、旧值读不出来
  it("放在自己的钥匙串服务里，不和普通条目共用命名空间", async () => {
    await store.set("wk", "value");

    expect(setItem).toHaveBeenCalledWith(
      "wk",
      "value",
      expect.objectContaining({
        keychainService: "foundation.wallet.authenticated",
      }),
    );
  });

  it("设备没录入生物识别时报不可用，而不是抛错把用户拦在外面", () => {
    const canUse = jest.mocked(SecureStore.canUseBiometricAuthentication);
    canUse.mockReturnValueOnce(false);
    expect(store.available()).toBe(false);

    canUse.mockImplementationOnce(() => {
      throw new Error("module unavailable");
    });
    expect(store.available()).toBe(false);
  });
});
