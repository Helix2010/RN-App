import type { BootstrapConfig } from "../config/bootstrap.schema";

export type UpdatePlan = "full" | "ota" | "none";

/**
 * 全量版本优先于 OTA：最低支持版本只能由新的原生包满足，旧 runtime
 * 下的 OTA 也不应覆盖一个已经可安装的完整版本。
 */
export function resolveUpdatePlan(config: BootstrapConfig): UpdatePlan {
  if (config.update.decision !== "none" && config.update.full.actionUrl) {
    return "full";
  }
  if (config.features.otaEnabled && config.update.ota.enabled) return "ota";
  return "none";
}
