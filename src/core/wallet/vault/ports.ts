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

/**
 * 绑定了用户认证的安全存储（安全评审 N6 / 方案 §3.5 的「A 路」）。
 *
 * 读它会弹系统验证框，JS 伪造不了也绕不开——这正是它与上面那个普通 SecureStore
 * 的全部区别，也是 N6 残留问题的直接修法。
 *
 * 两件必须记住的事：
 *
 * 1. **操作系统可以在任何时候作废这把密钥**。Android 上新录一枚指纹或换掉锁屏
 *    就会（expo-secure-store 没有关掉 setInvalidatedByBiometricEnrollment，
 *    而它默认为 true），iOS 上用的是 .biometryCurrentSet，生物识别集合变化就会。
 *    所以它**绝不能是包裹密钥的唯一副本**，必须与 wrap-key-envelope 的 B 路配对。
 * 2. 读它会**阻塞 JS 线程**。只能在受控时机读（显式解锁动作），不能在渲染过程里
 *    懒加载，否则用户看到的是整个界面冻住。
 *
 * `available()` 为 false 时这条路根本不可用（设备没录入生物识别），要当成正常
 * 状态处理，不能报错、更不能把用户拦在外面。
 */
export type AuthenticatedSecureStorePort = SecureStorePort & {
  available: () => boolean;
};

/**
 * 身份验证（生物识别 / 设备密码）。`unavailable` = 设备未录入，调用方不得因此把用户锁死。
 * 参数是内置字典的 key，不是文案：系统弹窗显示什么只由内置字典决定（安全评审 N12）。
 */
export type AuthOutcome = "success" | "cancelled" | "failed" | "unavailable";
export type AuthenticatePort = (reasonKey: string) => Promise<AuthOutcome>;

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
