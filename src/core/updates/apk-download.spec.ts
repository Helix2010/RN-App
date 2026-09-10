import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import * as FileSystem from "expo-file-system/legacy";
import { hashFileSha256 } from "./apk-download";

jest.mock("expo-file-system/legacy", () => ({
  EncodingType: { Base64: "base64" },
  cacheDirectory: "file:///cache/",
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
}));
jest.mock("expo-intent-launcher", () => ({ startActivityAsync: jest.fn() }));

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
