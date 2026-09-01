import * as SecureStore from "expo-secure-store";
import { authenticate } from "../../security/app-lock";
import type { AuthenticatePort, SecureStorePort } from "./ports";

/**
 * 生产端口实现。包裹密钥进 `expo-secure-store`（Android Keystore / iOS Keychain），
 * 身份验证复用应用锁那套 `expo-local-authentication`（已处理"设备只设了 PIN"
 * 与连续失败降级的坑）。
 */
export const expoSecureStore: SecureStorePort = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    }),
  remove: (key) => SecureStore.deleteItemAsync(key),
};

export const expoAuthenticate: AuthenticatePort = (reason) =>
  authenticate(reason);
