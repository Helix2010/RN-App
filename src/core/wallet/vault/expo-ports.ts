import * as SecureStore from "expo-secure-store";
import { authenticate } from "../../security/app-lock";
import type {
  AuthenticatePort,
  AuthenticatedSecureStorePort,
  SecureStorePort,
} from "./ports";

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

/** 认证提示文案的内置字典 key —— 与金库其它弹窗一样，文案不来自远程（安全评审 N12）。 */
const AUTHENTICATED_KEYCHAIN_SERVICE = "foundation.wallet.authenticated";

/**
 * 绑定用户认证的安全存储（方案 §3.5 的「A 路」）。
 *
 * Android 上 expo-secure-store 给认证条目和非认证条目用的是**两个不同的 keystore
 * 别名**（`:authenticated` / `:unauthenticated`），所以给一条已有条目"打开
 * requireAuthentication"实际上是换了一把密钥、旧值读不出来。开启流程必须是
 * "从 B 路读出 WK，再写进这里"，不能指望原地升级。
 */
export function expoAuthenticatedSecureStore(
  prompt: string,
): AuthenticatedSecureStorePort {
  const options = {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    keychainService: AUTHENTICATED_KEYCHAIN_SERVICE,
    requireAuthentication: true,
    authenticationPrompt: prompt,
  } as const;
  const scope = {
    keychainService: AUTHENTICATED_KEYCHAIN_SERVICE,
    requireAuthentication: true,
    authenticationPrompt: prompt,
  } as const;
  return {
    get: (key) => SecureStore.getItemAsync(key, scope),
    set: (key, value) => SecureStore.setItemAsync(key, value, options),
    remove: (key) =>
      SecureStore.deleteItemAsync(key, {
        keychainService: AUTHENTICATED_KEYCHAIN_SERVICE,
      }),
    // 设备没录入生物识别时这条路根本不可用。这是正常状态，不是错误。
    available: () => {
      try {
        return SecureStore.canUseBiometricAuthentication();
      } catch {
        return false;
      }
    },
  };
}
