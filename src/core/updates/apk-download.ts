import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { AppState } from "react-native";
import {
  ApkDownloadManager,
  type ApkDownloadDeps,
} from "./apk-download-manager";

/** 生产接线：expo-file-system（断点续传按 Android 语义 = 已写字节数）、系统安装器、前后台 */
export function createExpoApkDownloadDeps(): ApkDownloadDeps {
  const directory = `${FileSystem.cacheDirectory ?? ""}apk-updates/`;
  return {
    directory,
    createDownload: ({ url, fileUri, resumeFrom, onProgress }) => {
      const task = FileSystem.createDownloadResumable(
        url,
        fileUri,
        {},
        ({ totalBytesWritten, totalBytesExpectedToWrite }) =>
          onProgress(totalBytesWritten, totalBytesExpectedToWrite),
        resumeFrom === null ? undefined : String(resumeFrom),
      );
      return {
        start: () =>
          resumeFrom === null ? task.downloadAsync() : task.resumeAsync(),
        pause: () => task.pauseAsync(),
      };
    },
    fileInfo: async (uri) => {
      const info = await FileSystem.getInfoAsync(uri);
      return info?.exists && !info.isDirectory
        ? { exists: true, size: info.size }
        : { exists: false, size: 0 };
    },
    deleteFile: (uri) => FileSystem.deleteAsync(uri, { idempotent: true }),
    ensureDirectory: (dir) =>
      FileSystem.makeDirectoryAsync(dir, { intermediates: true }),
    listDirectory: async (dir) =>
      ((await FileSystem.readDirectoryAsync(dir)) ?? []).map(
        (name) => `${dir}${name}`,
      ),
    openInstaller: async (fileUri) => {
      const contentUri = await FileSystem.getContentUriAsync(fileUri);
      await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
        data: contentUri,
        type: "application/vnd.android.package-archive",
        flags: 1,
      });
    },
    isForeground: () => AppState.currentState === "active",
    onForeground: (listener) => {
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") listener();
      });
      return () => subscription.remove();
    },
    now: () => Date.now(),
  };
}

let manager: ApkDownloadManager | null = null;
/** 应用级单例；测试壳不走这里（直接 new 管理器并注入假依赖） */
export function getApkDownloadManager(): ApkDownloadManager {
  manager ??= new ApkDownloadManager(createExpoApkDownloadDeps());
  return manager;
}
