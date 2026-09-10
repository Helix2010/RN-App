import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { AppState } from "react-native";
import {
  ApkDownloadManager,
  ApkIntegrityError,
  type ApkDownloadDeps,
} from "./apk-download-manager";

/** 每次读 1 MiB：安装包几十 MB，整包读进 JS 堆会把低端机拖垮 */
const HASH_CHUNK_BYTES = 1024 * 1024;

function base64ToBytes(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** 分块计算文件 SHA-256（安全评审 N2：安装前必须与 bootstrap 下发的摘要一致） */
export async function hashFileSha256(uri: string): Promise<string> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || info.isDirectory)
    throw new ApkIntegrityError("file to hash is missing");
  const hasher = sha256.create();
  for (let position = 0; position < info.size; position += HASH_CHUNK_BYTES) {
    const length = Math.min(HASH_CHUNK_BYTES, info.size - position);
    const chunk = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
      position,
      length,
    });
    hasher.update(base64ToBytes(chunk));
  }
  return bytesToHex(hasher.digest());
}

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
    hashFile: hashFileSha256,
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
