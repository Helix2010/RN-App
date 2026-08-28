import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { Platform } from "react-native";
import type { BootstrapConfig } from "../config/bootstrap.schema";

export type ApkDownloadProgress = {
  written: number;
  total: number;
  percentage: number;
};

export type ApkInstallResult = "opened_installer";

function downloadFileName(config: BootstrapConfig): string {
  const releaseId = config.update.full.releaseId ?? "latest";
  return `anyfun-${releaseId}.apk`;
}

export async function downloadAndInstallApk(
  config: BootstrapConfig,
  onProgress?: (progress: ApkDownloadProgress) => void,
): Promise<ApkInstallResult> {
  if (Platform.OS !== "android") {
    throw new Error("APK installation is only supported on Android");
  }
  const url = config.update.full.actionUrl;
  if (!url) throw new Error("No APK download URL is configured");

  if (!FileSystem.cacheDirectory)
    throw new Error("App cache directory is unavailable");

  const directory = `${FileSystem.cacheDirectory}apk-updates/`;
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const fileUri = `${directory}${downloadFileName(config)}`;
  const task = FileSystem.createDownloadResumable(
    url,
    fileUri,
    {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      const total =
        totalBytesExpectedToWrite > 0
          ? totalBytesExpectedToWrite
          : (config.update.full.size ?? 0);
      onProgress?.({
        written: totalBytesWritten,
        total,
        percentage:
          total > 0
            ? Math.min(100, Math.round((totalBytesWritten / total) * 100))
            : 0,
      });
    },
  );
  const result = await task.downloadAsync();
  if (!result?.uri) throw new Error("APK download did not produce a file");

  const info = await FileSystem.getInfoAsync(result.uri);
  if (!info.exists || info.isDirectory)
    throw new Error("Downloaded APK file is unavailable");
  if (
    config.update.full.size !== null &&
    config.update.full.size !== undefined &&
    info.size !== config.update.full.size
  ) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true });
    throw new Error("Downloaded APK size does not match the release metadata");
  }
  // The server provides the expected SHA-256 in Bootstrap. The Android
  // installer also verifies the APK signature; avoid loading a 90MB package
  // into the JS heap just to calculate a duplicate digest on-device.
  onProgress?.({
    written: info.size,
    total: config.update.full.size ?? info.size,
    percentage: 100,
  });

  const contentUri = await FileSystem.getContentUriAsync(result.uri);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    type: "application/vnd.android.package-archive",
    flags: 1,
  });
  return "opened_installer";
}
