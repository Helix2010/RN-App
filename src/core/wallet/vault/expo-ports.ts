import * as SecureStore from "expo-secure-store";
import { authenticate } from "../../security/app-lock";
import type { AuthenticatePort, SecureStorePort } from "./ports";

/**
 * 生产端口实现。包裹密钥进 `expo-secure-store`（Android Keystore / iOS Keychain），
 * 身份验证复用应用锁那套 `expo-local-authentication`（已处理"设备只设了 PIN"
 * 与连续失败降级的坑）。
 */
/**
 * 建一个安全存储端口。`keychainService` 把条目放进独立的钥匙串服务 /
 * Keystore 别名空间：钱包私钥和预测平台凭证不再共用一个命名空间，任一侧的
 * 读写错误或清理都波及不到另一侧（安全评审 N21）。不传则用平台默认空间。
 */
export function expoSecureStoreIn(keychainService?: string): SecureStorePort {
  const options = keychainService
    ? {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
        keychainService,
      }
    : { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
  const scope = keychainService ? { keychainService } : undefined;
  return {
    get: (key) => SecureStore.getItemAsync(key, scope),
    set: (key, value) => SecureStore.setItemAsync(key, value, options),
    remove: (key) => SecureStore.deleteItemAsync(key, scope),
  };
}

/** 钱包金库用的存储（平台默认空间，保持既有条目可读）。 */
export const expoSecureStore: SecureStorePort = expoSecureStoreIn();

/** 预测平台凭证：与钱包密钥分开的钥匙串服务。 */
export const PREDICT_KEYCHAIN_SERVICE = "foundation.predict.credentials";
export const expoPredictSecureStore: SecureStorePort = expoSecureStoreIn(
  PREDICT_KEYCHAIN_SERVICE,
);

export const expoAuthenticate: AuthenticatePort = (reason) =>
  authenticate(reason);
