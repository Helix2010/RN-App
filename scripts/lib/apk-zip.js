const { Buffer } = require("node:buffer");
const { closeSync, fstatSync, openSync, readSync } = require("node:fs");
const { inflateRawSync } = require("node:zlib");

/**
 * 只读的 APK（ZIP）结构读取：中央目录、APK Signing Block 魔数、单个条目的内容。
 *
 * 构建脚本用它在不依赖 Android SDK 的情况下回答两件事：包里有没有签名痕迹
 * （v1 签名文件、v2+ 的 APK Signing Block），以及内嵌的 `assets/app.config` 是什么。
 * 读不懂的结构一律报错，不猜：ZIP64、中央目录与结尾记录对不上、条目头损坏。
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT = 0xffff;
const APK_SIGNING_BLOCK_MAGIC = Buffer.from("APK Sig Block 42", "latin1");

function readAt(fd, position, length) {
  const buffer = Buffer.alloc(length);
  const read = readSync(fd, buffer, 0, length, position);
  if (read !== length)
    throw new Error(`ZIP truncated: wanted ${length} bytes at ${position}`);
  return buffer;
}

function withFile(path, run) {
  const fd = openSync(path, "r");
  try {
    return run(fd, fstatSync(fd).size);
  } finally {
    closeSync(fd);
  }
}

function readDirectory(fd, size) {
  if (size < EOCD_MIN_SIZE)
    throw new Error("not a ZIP archive: file is too small");
  const tailLength = Math.min(size, EOCD_MIN_SIZE + MAX_COMMENT);
  const tailStart = size - tailLength;
  const tail = readAt(fd, tailStart, tailLength);
  let eocd = -1;
  for (let index = tail.length - EOCD_MIN_SIZE; index >= 0; index -= 1) {
    if (
      tail.readUInt32LE(index) === EOCD_SIGNATURE &&
      index + EOCD_MIN_SIZE + tail.readUInt16LE(index + 20) === tail.length
    ) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0)
    throw new Error("not a ZIP archive: no end of central directory record");
  const totalEntries = tail.readUInt16LE(eocd + 10);
  const directorySize = tail.readUInt32LE(eocd + 12);
  const directoryOffset = tail.readUInt32LE(eocd + 16);
  if (
    totalEntries === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  )
    throw new Error("ZIP64 archives are not supported");
  if (directoryOffset + directorySize !== tailStart + eocd)
    throw new Error(
      "ZIP central directory does not end where the end record starts",
    );

  const directory = readAt(fd, directoryOffset, directorySize);
  const entries = [];
  let cursor = 0;
  for (let count = 0; count < totalEntries; count += 1) {
    if (
      cursor + 46 > directory.length ||
      directory.readUInt32LE(cursor) !== CENTRAL_SIGNATURE
    )
      throw new Error(`ZIP central directory entry ${count} is malformed`);
    const nameLength = directory.readUInt16LE(cursor + 28);
    const extraLength = directory.readUInt16LE(cursor + 30);
    const commentLength = directory.readUInt16LE(cursor + 32);
    entries.push({
      name: directory.toString("utf8", cursor + 46, cursor + 46 + nameLength),
      method: directory.readUInt16LE(cursor + 10),
      compressedSize: directory.readUInt32LE(cursor + 20),
      uncompressedSize: directory.readUInt32LE(cursor + 24),
      localHeaderOffset: directory.readUInt32LE(cursor + 42),
    });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== directory.length)
    throw new Error("ZIP central directory has trailing bytes");

  // APK Signing Block 紧挨在中央目录前面，以 16 字节魔数结尾（v2/v3/v3.1/v4 都在这个块里）
  const hasApkSigningBlock =
    directoryOffset >= APK_SIGNING_BLOCK_MAGIC.length &&
    readAt(
      fd,
      directoryOffset - APK_SIGNING_BLOCK_MAGIC.length,
      APK_SIGNING_BLOCK_MAGIC.length,
    ).equals(APK_SIGNING_BLOCK_MAGIC);
  return { entries, hasApkSigningBlock };
}

/** 中央目录里的全部条目，以及中央目录前有没有 APK Signing Block。 */
function readZipDirectory(path) {
  return withFile(path, readDirectory);
}

/** 读一个条目的解压后内容；条目不存在返回 null。只支持 STORED 与 DEFLATE。 */
function readZipEntry(path, name, { maxBytes = 16 * 1024 * 1024 } = {}) {
  return withFile(path, (fd, size) => {
    const matches = readDirectory(fd, size).entries.filter(
      (entry) => entry.name === name,
    );
    if (matches.length === 0) return null;
    if (matches.length > 1)
      throw new Error(`ZIP has ${matches.length} entries named ${name}`);
    const [entry] = matches;
    if (entry.uncompressedSize > maxBytes)
      throw new Error(`${name} is larger than ${maxBytes} bytes`);
    const header = readAt(fd, entry.localHeaderOffset, 30);
    if (header.readUInt32LE(0) !== LOCAL_SIGNATURE)
      throw new Error(`ZIP local header for ${name} is malformed`);
    const dataStart =
      entry.localHeaderOffset +
      30 +
      header.readUInt16LE(26) +
      header.readUInt16LE(28);
    const raw = readAt(fd, dataStart, entry.compressedSize);
    let data;
    if (entry.method === 0) data = raw;
    else if (entry.method === 8)
      data = inflateRawSync(raw, { maxOutputLength: maxBytes });
    else
      throw new Error(
        `${name} uses unsupported ZIP compression method ${entry.method}`,
      );
    if (data.length !== entry.uncompressedSize)
      throw new Error(`${name} inflated to an unexpected size`);
    return data;
  });
}

module.exports = { readZipDirectory, readZipEntry };
