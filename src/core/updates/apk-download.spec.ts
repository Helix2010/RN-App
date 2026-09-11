import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as FileSystem from "expo-file-system/legacy";
import { createExpoApkDownloadDeps, hashFileSha256 } from "./apk-download";

jest.mock("expo-file-system/legacy", () => ({
  EncodingType: { Base64: "base64" },
  cacheDirectory: "file:///cache/",
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  createDownloadResumable: jest.fn(),
}));
jest.mock("expo-intent-launcher", () => ({ startActivityAsync: jest.fn() }));
jest.mock("../device/installation-service", () => ({
  installationAuthorization: jest.fn(async () => ({})),
}));

const { installationAuthorization } = jest.requireMock(
  "../device/installation-service",
) as { installationAuthorization: jest.Mock };

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary);
}

/** 假文件：按 position/length 分片返回 base64，和 expo-file-system 的分片读语义一致 */
function serveFile(bytes: Uint8Array) {
  jest.mocked(FileSystem.getInfoAsync).mockResolvedValue({
    exists: true,
    isDirectory: false,
    size: bytes.length,
  } as Awaited<ReturnType<typeof FileSystem.getInfoAsync>>);
  jest
    .mocked(FileSystem.readAsStringAsync)
    .mockImplementation(async (_uri, options) => {
      const position = options?.position ?? 0;
      const length = options?.length ?? bytes.length;
      return bytesToBase64(bytes.subarray(position, position + length));
    });
}

describe("hashFileSha256", () => {
  it("hashes a file larger than one chunk, with a tail that is not chunk-aligned, exactly like a whole-buffer digest", async () => {
    // 2.5 MiB + 13 字节：跨越三个 1 MiB 分片，最后一片不是整块
    const bytes = new Uint8Array(2.5 * 1024 * 1024 + 13);
    for (let index = 0; index < bytes.length; index += 1)
      bytes[index] = (index * 31 + 7) & 0xff;
    serveFile(bytes);
    await expect(hashFileSha256("file:///cache/x.apk")).resolves.toBe(
      bytesToHex(sha256(bytes)),
    );
    // 三次分片读：1 MiB、1 MiB、剩余
    const calls = jest.mocked(FileSystem.readAsStringAsync).mock.calls;
    expect(calls.map((call) => call[1]?.length)).toEqual([
      1024 * 1024,
      1024 * 1024,
      0.5 * 1024 * 1024 + 13,
    ]);
  });

  it("hashes an empty file and refuses a missing one", async () => {
    serveFile(new Uint8Array(0));
    await expect(hashFileSha256("file:///cache/empty.apk")).resolves.toBe(
      bytesToHex(sha256(new Uint8Array(0))),
    );
    jest.mocked(FileSystem.getInfoAsync).mockResolvedValue({
      exists: false,
    } as Awaited<ReturnType<typeof FileSystem.getInfoAsync>>);
    await expect(hashFileSha256("file:///cache/gone.apk")).rejects.toThrow(
      "file to hash is missing",
    );
  });
});

// 灰度包只对名单里的安装可见：下载不带身份就是 404，用户看得到版本却装不上
// （设计 canary-release-allowlist-2026-09-11 §3.4，2026-09-11 在模拟器上真的踩到过）
describe("createExpoApkDownloadDeps", () => {
  beforeEach(() => {
    jest.mocked(FileSystem.createDownloadResumable).mockReset();
    installationAuthorization.mockReset();
    installationAuthorization.mockResolvedValue({});
  });

  function stubTask() {
    const downloadAsync = jest.fn(async () => ({ uri: "file:///cache/a.apk" }));
    const resumeAsync = jest.fn(async () => ({ uri: "file:///cache/a.apk" }));
    const pauseAsync = jest.fn(async () => undefined);
    jest
      .mocked(FileSystem.createDownloadResumable)
      .mockReturnValue({ downloadAsync, resumeAsync, pauseAsync } as never);
    return { downloadAsync, resumeAsync, pauseAsync };
  }

  it("sends the installation credential so a canary build can actually be downloaded", async () => {
    installationAuthorization.mockResolvedValue({
      "X-Installation-ID": "inst_1",
      Authorization: "Installation icred_abc",
    });
    const { downloadAsync } = stubTask();

    const task = createExpoApkDownloadDeps().createDownload({
      url: "https://api.example.com/v1/public/releases/rel_1/download",
      fileUri: "file:///cache/a.apk",
      resumeFrom: null,
      onProgress: () => undefined,
    });
    await task.start();

    const [, , options] = jest.mocked(FileSystem.createDownloadResumable).mock
      .calls[0] as [string, string, { headers?: Record<string, string> }];
    expect(options.headers).toEqual({
      "X-Installation-ID": "inst_1",
      Authorization: "Installation icred_abc",
    });
    expect(downloadAsync).toHaveBeenCalled();
  });

  it("still downloads an active build when the installation is not registered yet", async () => {
    const { downloadAsync } = stubTask();

    const task = createExpoApkDownloadDeps().createDownload({
      url: "https://api.example.com/v1/public/releases/rel_1/download",
      fileUri: "file:///cache/a.apk",
      resumeFrom: null,
      onProgress: () => undefined,
    });
    await task.start();

    const [, , options] = jest.mocked(FileSystem.createDownloadResumable).mock
      .calls[0] as [string, string, { headers?: Record<string, string> }];
    expect(options.headers).toEqual({});
    expect(downloadAsync).toHaveBeenCalled();
  });

  it("resumes from the byte offset and still carries the credential", async () => {
    installationAuthorization.mockResolvedValue({
      "X-Installation-ID": "inst_1",
      Authorization: "Installation icred_abc",
    });
    const { resumeAsync, downloadAsync } = stubTask();

    const task = createExpoApkDownloadDeps().createDownload({
      url: "https://api.example.com/v1/public/releases/rel_1/download",
      fileUri: "file:///cache/a.apk",
      resumeFrom: 4096,
      onProgress: () => undefined,
    });
    await task.start();

    expect(resumeAsync).toHaveBeenCalled();
    expect(downloadAsync).not.toHaveBeenCalled();
    const call = jest.mocked(FileSystem.createDownloadResumable).mock
      .calls[0] as unknown as unknown[];
    expect(call[4]).toBe("4096");
  });

  // 任务在 start 里才建（凭证是异步读的）：还没开始就被叫停不能炸
  it("tolerates a pause before the download ever started", async () => {
    stubTask();
    const task = createExpoApkDownloadDeps().createDownload({
      url: "https://api.example.com/v1/public/releases/rel_1/download",
      fileUri: "file:///cache/a.apk",
      resumeFrom: null,
      onProgress: () => undefined,
    });
    await expect(task.pause()).resolves.toBeUndefined();
    expect(FileSystem.createDownloadResumable).not.toHaveBeenCalled();
  });
});
