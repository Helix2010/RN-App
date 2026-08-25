import * as Linking from "expo-linking";
import * as Updates from "expo-updates";
import type { BootstrapConfig } from "../config/bootstrap.schema";

export type OtaCheckResult =
  | { status: "disabled"; message: string }
  | { status: "current"; message: string }
  | { status: "ready"; message: string }
  | { status: "error"; message: string };

export async function checkAndDownloadOta(
  config: BootstrapConfig,
): Promise<OtaCheckResult> {
  if (!config.features.otaEnabled || !config.update.ota.enabled) {
    return { status: "disabled", message: "OTA 已被远程策略关闭" };
  }
  if (!Updates.isEnabled) {
    return {
      status: "disabled",
      message:
        "当前开发容器未启用 OTA；请使用 Development Build 或发布构建验证",
    };
  }

  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) {
      return { status: "current", message: "当前 runtime 已是最新 OTA" };
    }
    const result = await Updates.fetchUpdateAsync();
    return result.isNew
      ? { status: "ready", message: "OTA 已下载，重启后应用" }
      : { status: "current", message: "没有新的兼容 OTA" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "OTA 检查失败",
    };
  }
}

export async function applyDownloadedOta(): Promise<void> {
  await Updates.reloadAsync();
}

export async function openFullUpdate(
  config: BootstrapConfig,
): Promise<boolean> {
  const url = config.update.full.actionUrl;
  if (!url || !(await Linking.canOpenURL(url))) return false;
  await Linking.openURL(url);
  return true;
}
