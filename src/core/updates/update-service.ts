import * as Linking from "expo-linking";
import * as Updates from "expo-updates";
import type { BootstrapConfig } from "../config/bootstrap.schema";

export type OtaCheckResult =
  | { status: "disabled"; messageKey: string }
  | { status: "current"; messageKey: string }
  | { status: "ready"; messageKey: string }
  | { status: "error"; messageKey: string };

export async function checkAndDownloadOta(
  config: BootstrapConfig,
): Promise<OtaCheckResult> {
  if (!config.features.otaEnabled || !config.update.ota.enabled) {
    return { status: "disabled", messageKey: "update.otaDisabled" };
  }
  if (!Updates.isEnabled) {
    return {
      status: "disabled",
      messageKey: "update.otaUnavailable",
    };
  }

  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) {
      return { status: "current", messageKey: "update.otaCurrent" };
    }
    const result = await Updates.fetchUpdateAsync();
    return result.isNew
      ? { status: "ready", messageKey: "update.otaReady" }
      : { status: "current", messageKey: "update.otaCurrent" };
  } catch {
    return {
      status: "error",
      messageKey: "update.otaError",
    };
  }
}

export async function applyDownloadedOta(): Promise<void> {
  await Updates.reloadAsync();
}

export async function openFullUpdate(
  config: BootstrapConfig,
): Promise<boolean> {
  if (
    config.app.platform === "android" &&
    config.app.distribution === "direct" &&
    !config.features.directUpdateEnabled
  ) {
    return false;
  }
  const url = config.update.full.actionUrl;
  if (!url || !(await Linking.canOpenURL(url))) return false;
  await Linking.openURL(url);
  return true;
}
