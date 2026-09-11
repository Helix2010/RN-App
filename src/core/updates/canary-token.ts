import * as Updates from "expo-updates";

/**
 * 灰度令牌的落盘（设计 canary-release-allowlist-2026-09-11 §3.3 / §9.4）。
 *
 * OTA 的 manifest 请求由 expo-updates 在**启动时、JS 跑起来之前**从原生侧发出，
 * 带不了 `Authorization`。能用的只有 extra params：它由原生侧持久化，
 * **下次启动那一次原生请求**就会以 `Expo-Extra-Params` 捎上。
 * （`setUpdateRequestHeadersOverride` 由 JS 调用，对本次启动那一次检查已经来不及，
 * 而且标着 @experimental。）
 *
 * 所以令牌总是"这次存、下次生效"，服务端因此在每次 bootstrap 都下发一个新的，
 * 不等到有灰度包才发——等看见灰度包再发就永远慢一拍。
 */

/**
 * 键必须全小写：`Expo-Extra-Params` 是 RFC 8941 结构化字典，
 * expo-structured-headers 的 `Utils.checkKey` 只接受 lcalpha / digit / `_-.*`，
 * 键里有一个大写字母就会在拼 manifest 请求头时抛 IllegalArgumentException，
 * 把整条更新链路打断。
 */
const CANARY_PARAM_KEY = "canary-token";

/** 记住上一次写进去的值，避免每次 bootstrap 都去动一次原生存储。 */
let lastWritten: string | null | undefined;

/**
 * 把服务端下发的灰度令牌交给 expo-updates；`null` 表示这台设备这次没有被认出
 * 身份，要把旧令牌清掉（过期令牌留着没用，服务端也只会按匿名处理）。
 *
 * 失败一律吞掉：灰度是附加能力，它不该影响启动，也不该影响正常的 OTA 检查。
 */
export async function rememberCanaryToken(token: string | null): Promise<void> {
  if (!Updates.isEnabled) return;
  if (lastWritten === token) return;
  try {
    await Updates.setExtraParamAsync(CANARY_PARAM_KEY, token);
    lastWritten = token;
  } catch {
    // 开发构建（UpdatesDevLauncherController）会直接抛 NotAvailableInDevClient，
    // 这是预期的：开发机不参与灰度
  }
}

/** 仅供测试：清掉"上次写了什么"的记忆。 */
export function resetCanaryTokenCache(): void {
  lastWritten = undefined;
}
