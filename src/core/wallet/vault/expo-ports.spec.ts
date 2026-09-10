import * as SecureStore from "expo-secure-store";

import {
  PREDICT_KEYCHAIN_SERVICE,
  expoPredictSecureStore,
  expoSecureStore,
  expoSecureStoreIn,
} from "./expo-ports";

jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "afterFirstUnlockThisDeviceOnly",
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
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
