import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
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
 * 不整包读：安装包几十 MB，一次读进 JS 堆会把低端机拖垮。
 * 也不读太小：每个分片都是一次 expo-file-system 的跨桥调用，返回的还是
 * base64（比原始字节大 4/3）。1 MiB 的分片对一个 39 MB 的包就是 39 次往返、
 * 约 52 MB 的 base64 字符串要跨桥搬运并在 JS 堆上分配——这是「下载到 100% 之后
 * 还要等好几秒」的主要开销。4 MiB 把往返次数降到 10 次，单次瞬时占用约 13 MB
 * （base64 串 + 解码出的串 + 字节数组），仍然有界。
 *
 * 真正的解法是让原生一侧直接算摘要或吐原始字节（expo-file-system 的新 File API
 * 有 readableStream，但本仓没有流 polyfill，release 包里未验证），那是另一件事。
 */
export const HASH_CHUNK_BYTES = 4 * 1024 * 1024;

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
