import { fill } from "../../core/i18n/format";
import type { OtaCheckResult } from "../../core/updates/update-service";
import type { ManualUpdateCheckState } from "./use-manual-update-check";

/**
 * 「检查更新」一行的值文案，设置页和关于页共用。
 *
 * 文案直接反映运行时的 OTA 状态，而不是只看这次手动检查的结果：启动时的
 * 静默检查可能已经把更新下载好了，这时不管用户点没点，这一行都得说
 * "已下载，下次启动生效"，不能写"已是最新版本"。
 */
export function updateCheckRowValue(input: {
  t: (key: string) => string;
  state: ManualUpdateCheckState;
  hasUpdate: boolean;
  latestVersion: string;
  otaResult: OtaCheckResult | null;
}): string {
  const { t, state, hasUpdate, latestVersion, otaResult } = input;
  if (state === "checking") return t("update.checking");
  if (state === "error") return t("status.error");
  if (hasUpdate) {
    return fill(t("settings.newVersion"), { version: latestVersion });
  }
  if (otaResult && otaResult.status !== "current") {
    return t(otaResult.messageKey);
  }
  return t("settings.upToDate");
}
