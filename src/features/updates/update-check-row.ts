import { fill } from "../../core/i18n/format";
import type { ApkDownloadState } from "../../core/updates/apk-download-manager";
import type { OtaCheckResult } from "../../core/updates/update-service";
import type { ManualUpdateCheckState } from "./use-manual-update-check";

/** 安装包下载进行中 / 暂停 / 就绪时，这一行说下载状态而不是"发现新版本" */
export function apkDownloadRowValue(
  t: (key: string) => string,
  download: ApkDownloadState | undefined,
): string | null {
  if (!download) return null;
  switch (download.phase) {
    case "downloading":
      return fill(t("update.downloadingRow"), {
        percent:
          download.total > 0
            ? Math.min(
                100,
                Math.round((download.written / download.total) * 100),
              )
            : 0,
      });
    case "paused":
      return t(
        download.reason === "stalled"
          ? "update.pausedStalled"
          : "update.pausedNetwork",
      );
    case "failed":
      return t("update.downloadFailed");
    case "ready":
    case "installing":
      return t("update.readyToInstall");
    default:
      return null;
  }
}

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
  download?: ApkDownloadState;
}): string {
  const { t, state, hasUpdate, latestVersion, otaResult, download } = input;
  if (state === "checking") return t("update.checking");
  if (state === "error") return t("update.checkFailed");
  const downloadValue = apkDownloadRowValue(t, download);
  if (hasUpdate && downloadValue) return downloadValue;
  if (hasUpdate) {
    return fill(t("settings.newVersion"), { version: latestVersion });
  }
  if (otaResult && otaResult.status !== "current") {
    return t(otaResult.messageKey);
  }
  return t("settings.upToDate");
}
