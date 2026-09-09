import { useFoundationRuntime } from "../../app/runtime-context";
import { fill } from "../../core/i18n/format";
import { useApkDownloadStore } from "../../core/updates/apk-download-manager";
import { PrimaryButton } from "../../design-system";
import { apkDownloadRowValue } from "./update-check-row";

/**
 * 关于页"新版本"卡的按钮：随下载状态变——立即更新（刷新并弹层）/ 下载中 x% / 继续下载 / 重试 / 安装。
 * 除"立即更新"外都只是把弹层打开让用户在同一处操作，不在这里重复下载逻辑。
 */
export function ApkUpdateButton({
  onCheck,
  testID,
}: {
  onCheck: () => void;
  testID?: string;
}) {
  const { config, t, promptUpdate } = useFoundationRuntime();
  const download = useApkDownloadStore((state) => state.state);
  const sameRelease =
    download.phase !== "idle" &&
    download.releaseId === config.update.full.releaseId;
  const label = sameRelease
    ? download.phase === "downloading"
      ? fill(t("update.downloadingRow"), {
          percent:
            download.total > 0
              ? Math.min(
                  100,
                  Math.round((download.written / download.total) * 100),
                )
              : 0,
        })
      : download.phase === "paused"
        ? t("update.resume")
        : download.phase === "failed"
          ? t("update.retryDownload")
          : t("update.install")
    : t("update.viewNow");
  return (
    <PrimaryButton
      onPress={sameRelease ? promptUpdate : onCheck}
      accessibilityHint={apkDownloadRowValue(t, download) ?? undefined}
      testID={testID}
    >
      {label}
    </PrimaryButton>
  );
}
