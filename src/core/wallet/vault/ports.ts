/**
 * Vault 的外部依赖端口。全部注入，便于单测；生产实现在 `expo-ports.ts`。
 * 这里刻意不 import 任何网络模块 —— 密钥边界内只允许"安全存储 + 身份验证 + RNG"，
 * 对应 Robinhood microgram 沙箱只暴露"消息总线 + 安全 RNG"的能力边界。
 */

/** 由系统硬件密钥库（Android Keystore / iOS Keychain）支撑的小容量存储。 */
export type SecureStorePort = {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

/** 身份验证（生物识别 / 设备密码）。`unavailable` = 设备未录入，调用方不得因此把用户锁死。 */
export type AuthOutcome = "success" | "cancelled" | "failed" | "unavailable";
export type AuthenticatePort = (reason: string) => Promise<AuthOutcome>;

export function memorySecureStore(): SecureStorePort {
  const map = new Map<string, string>();
  return {
    get: async (key) => map.get(key) ?? null,
    set: async (key, value) => {
      map.set(key, value);
    },
    remove: async (key) => {
      map.delete(key);
    },
  };
}
