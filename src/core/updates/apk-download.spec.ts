import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as FileSystem from "expo-file-system/legacy";
import {
  HASH_CHUNK_BYTES,
  createExpoApkDownloadDeps,
  hashFileSha256,
} from "./apk-download";

jest.mock("expo-file-system/legacy", () => ({
  EncodingType: { Base64: "base64" },
  cacheDirectory: "file:///cache/",
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  createDownloadResumable: jest.fn(),
}));
// 新 API：File.open() 给一个同步读原始字节的句柄。
// 变量名必须以 mock 开头，否则 jest 不允许 mock 工厂引用它
const mockOpenHandle = jest.fn();
jest.mock("expo-file-system", () => ({
  FileMode: { ReadOnly: "r" },
  File: jest.fn().mockImplementation(() => ({ open: mockOpenHandle })),
}));
jest.mock("expo-intent-launcher", () => ({ startActivityAsync: jest.fn() }));
jest.mock("../device/installation-service", () => ({
  installationTransportHeaders: jest.fn(async () => ({
    "X-Platform": "android",
    "X-Application-ID": "dex-mobile",
  })),
}));

const { installationTransportHeaders } = jest.requireMock(
  "../device/installation-service",
) as { installationTransportHeaders: jest.Mock };

/** 假文件句柄：按游标顺序吐原始字节，和 FileHandle.readBytes 的语义一致 */
function serveFile(bytes: Uint8Array) {
  jest.mocked(FileSystem.getInfoAsync).mockResolvedValue({
    exists: true,
    isDirectory: false,
    size: bytes.length,
  } as Awaited<ReturnType<typeof FileSystem.getInfoAsync>>);
  const reads: number[] = [];
  let cursor = 0;
  const close = jest.fn();
  mockOpenHandle.mockReturnValue({
    readBytes: (length: number) => {
      reads.push(length);
      const chunk = bytes.subarray(cursor, cursor + length);
      cursor += chunk.length;
      return chunk;
    },
    close,
  });
  return { reads, close };
}

describe("hashFileSha256", () => {
  it("hashes a file larger than one chunk, with a tail that is not chunk-aligned, exactly like a whole-buffer digest", async () => {
    // 两个整分片 + 一个不足分片的尾巴。尺寸从 HASH_CHUNK_BYTES 派生：
    // 分片大小是会被调的（它决定跨桥次数），写死数字的话一改就测不到跨分片
    const tail = 13;
    const bytes = new Uint8Array(HASH_CHUNK_BYTES * 2 + tail);
    for (let index = 0; index < bytes.length; index += 1)
      bytes[index] = (index * 31 + 7) & 0xff;
    const file = serveFile(bytes);
    await expect(hashFileSha256("file:///cache/x.apk")).resolves.toBe(
      bytesToHex(sha256(bytes)),
    );
    expect(file.reads).toEqual([HASH_CHUNK_BYTES, HASH_CHUNK_BYTES, tail]);
    // 句柄持着文件描述符，必须关掉
    expect(file.close).toHaveBeenCalled();
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
    installationTransportHeaders.mockReset();
    installationTransportHeaders.mockResolvedValue({
      "X-Platform": "android",
      "X-Application-ID": "dex-mobile",
    });
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
    installationTransportHeaders.mockResolvedValue({
      "X-Platform": "android",
      "X-Application-ID": "dex-mobile",
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
    // 平台与应用身份必须一起带：服务端按四元组定位安装记录，缺一个就查不到行
    expect(options.headers).toEqual({
      "X-Platform": "android",
      "X-Application-ID": "dex-mobile",
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
    expect(options.headers).toEqual({
      "X-Platform": "android",
      "X-Application-ID": "dex-mobile",
    });
    expect(downloadAsync).toHaveBeenCalled();
  });

  it("resumes from the byte offset and still carries the credential", async () => {
    installationTransportHeaders.mockResolvedValue({
      "X-Platform": "android",
      "X-Application-ID": "dex-mobile",
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
