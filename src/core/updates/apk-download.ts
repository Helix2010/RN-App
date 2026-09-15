import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { File, FileMode } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { AppState } from "react-native";
import { installationTransportHeaders } from "../device/installation-service";
import {
  ApkDownloadManager,
  ApkIntegrityError,
  type ApkDownloadDeps,
} from "./apk-download-manager";

/**
 * 每次读 4 MiB。
 *
 * 不整包读：安装包几十 MB，一次读进 JS 堆会把低端机拖垮。分片大小只影响
 * readBytes 的调用次数与瞬时占用，不影响结果。
 */
export const HASH_CHUNK_BYTES = 4 * 1024 * 1024;

/**
 * 分块计算文件 SHA-256（安全评审 N2：安装前必须与 bootstrap 下发的摘要一致）。
 *
 * 走 `File.open()` 拿到的句柄按**原始字节**读。原先的写法是
 * `readAsStringAsync(..., Base64)`：每片跨一次桥、返回一个比原始字节大 4/3 的
 * base64 字符串，再 `atob()` 出一个同长度的 JS 字符串，再用 `charCodeAt` 逐字节
 * 填进 `Uint8Array`。一个 39 MB 的包就是约 52 MB 的字符串跨桥搬运、
 * 约 4100 万次 `charCodeAt`——**模拟器上实测这一步要 59 秒**，用户看到的就是
 * 「下载 100% 之后卡住不动」。`readBytes` 是同步的 JSI 调用，直接给
 * `Uint8Array`，那三层全部省掉。
 *
 * 句柄一定要 close：它持着一个文件描述符。
 */
export async function hashFileSha256(uri: string): Promise<string> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || info.isDirectory)
    throw new ApkIntegrityError("file to hash is missing");
  const handle = new File(uri).open(FileMode.ReadOnly);
  try {
    const hasher = sha256.create();
    for (let read = 0; read < info.size;) {
      const chunk = handle.readBytes(
        Math.min(HASH_CHUNK_BYTES, info.size - read),
      );
      // 读不出字节却还没到末尾：文件在校验途中被截断或换掉了，
      // 继续循环会空转。按完整性问题处理，重试无济于事
      if (chunk.length === 0)
        throw new ApkIntegrityError(
          `file to hash ended early at ${read} of ${info.size} bytes`,
        );
      hasher.update(chunk);
      read += chunk.length;
    }
    return bytesToHex(hasher.digest());
  } finally {
    handle.close();
  }
}

/** 生产接线：expo-file-system（断点续传按 Android 语义 = 已写字节数）、系统安装器、前后台 */
export function createExpoApkDownloadDeps(): ApkDownloadDeps {
  const directory = `${FileSystem.cacheDirectory ?? ""}apk-updates/`;
  return {
    directory,
    createDownload: ({ url, fileUri, resumeFrom, onProgress }) => {
      // 下载要带安装身份：灰度包只对名单里的安装可见，匿名地拉它是 404。
      // 这条请求不走 apiClient，平台与应用身份两个头也得自己带上——服务端按
      // (tenant, application_id, platform, installation_id) 定位安装记录，
      // 少一个就查不到行（模拟器上实测：只带凭证仍然 404）。
      // 凭证要到运行时才读得到（钥匙串），所以任务在 start 里才建；没注册过就
      // 不带，正式包照样下得动（设计 canary-release-allowlist-2026-09-11 §3.4）
      let task: FileSystem.DownloadResumable | null = null;
      return {
        start: async () => {
          task = FileSystem.createDownloadResumable(
            url,
            fileUri,
            { headers: await installationTransportHeaders() },
            ({ totalBytesWritten, totalBytesExpectedToWrite }) =>
              onProgress(totalBytesWritten, totalBytesExpectedToWrite),
            resumeFrom === null ? undefined : String(resumeFrom),
          );
          return resumeFrom === null
            ? task.downloadAsync()
            : task.resumeAsync();
        },
        // 还没 start 就被叫停：没有任务可暂停，什么都不做
        pause: async () => {
          await task?.pauseAsync();
        },
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
