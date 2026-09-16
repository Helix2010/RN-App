const { Buffer } = require("node:buffer");
const {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} = require("node:fs");
const { spawnSync } = require("node:child_process");
const { deflateRawSync } = require("node:zlib");
const { dirname, join } = require("node:path");

/**
 * 测试专用：现场合成很小的 APK，真实的 apksigner / aapt 能读懂它。
 *
 * 仓库里不放二进制夹具，也不拿线上的包来测：合成包里只有一份二进制
 * AndroidManifest.xml（apksigner 要从里面读 minSdk，aapt 要读包名与版本）、
 * 一份内嵌 `assets/app.config` 和一个占位 `classes.dex`。
 */

// ---- 二进制 XML（AXML）----------------------------------------------------

const ANDROID_NS = "http://schemas.android.com/apk/res/android";
/** android 命名空间属性的资源 ID（frameworks/base/core/res/res/values/public.xml） */
const ANDROID_ATTR_IDS = {
  name: 0x01010003,
  minSdkVersion: 0x0101020c,
  versionCode: 0x0101021b,
  versionName: 0x0101021c,
  targetSdkVersion: 0x01010270,
};
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const NO_INDEX = 0xffffffff;

function chunk(type, headerSize, body) {
  const header = Buffer.alloc(8);
  header.writeUInt16LE(type, 0);
  header.writeUInt16LE(headerSize, 2);
  header.writeUInt32LE(8 + body.length, 4);
  return Buffer.concat([header, body]);
}

function utf8String(value) {
  const bytes = Buffer.from(value, "utf8");
  if (value.length > 0x7f || bytes.length > 0x7f)
    throw new Error("fixture strings stay under 128 bytes");
  return Buffer.concat([
    Buffer.from([value.length, bytes.length]),
    bytes,
    Buffer.from([0]),
  ]);
}

function stringPool(strings) {
  const encoded = strings.map(utf8String);
  const offsets = Buffer.alloc(4 * strings.length);
  let cursor = 0;
  encoded.forEach((item, index) => {
    offsets.writeUInt32LE(cursor, index * 4);
    cursor += item.length;
  });
  let data = Buffer.concat(encoded);
  data = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(strings.length, 0); // stringCount
  header.writeUInt32LE(0, 4); // styleCount
  header.writeUInt32LE(0x100, 8); // UTF8_FLAG
  header.writeUInt32LE(28 + offsets.length, 12); // stringsStart
  header.writeUInt32LE(0, 16); // stylesStart
  return chunk(0x0001, 28, Buffer.concat([header, offsets, data]));
}

/**
 * `<manifest package versionCode versionName><uses-sdk/><uses-permission/>*<application/></manifest>`
 */
function binaryManifest({
  packageName,
  versionCode,
  versionName,
  minSdk = 24,
  targetSdk = 36,
  permissions = [],
}) {
  // 带资源 ID 的属性名必须排在字符串池最前面，资源映射表按下标对应
  const attrNames = Object.keys(ANDROID_ATTR_IDS);
  const strings = [
    ...attrNames,
    "android",
    ANDROID_NS,
    "manifest",
    "package",
    "uses-sdk",
    "uses-permission",
    "application",
    packageName,
    versionName,
    ...permissions,
  ];
  const index = (value) => {
    const found = strings.indexOf(value);
    if (found < 0) throw new Error(`string not pooled: ${value}`);
    return found;
  };
  const resourceMap = Buffer.alloc(4 * attrNames.length);
  attrNames.forEach((name, position) =>
    resourceMap.writeUInt32LE(ANDROID_ATTR_IDS[name], position * 4),
  );

  const node = (type, body) => {
    const prefix = Buffer.alloc(8);
    prefix.writeUInt32LE(1, 0); // lineNumber
    prefix.writeUInt32LE(NO_INDEX, 4); // comment
    return chunk(type, 16, Buffer.concat([prefix, body]));
  };
  const namespace = (type) => {
    const body = Buffer.alloc(8);
    body.writeUInt32LE(index("android"), 0);
    body.writeUInt32LE(index(ANDROID_NS), 4);
    return node(type, body);
  };
  const attribute = ({ android, name, string, int }) => {
    const buffer = Buffer.alloc(20);
    buffer.writeUInt32LE(android ? index(ANDROID_NS) : NO_INDEX, 0);
    buffer.writeUInt32LE(index(name), 4);
    buffer.writeUInt32LE(string === undefined ? NO_INDEX : index(string), 8);
    buffer.writeUInt16LE(8, 12);
    buffer.writeUInt8(0, 14);
    buffer.writeUInt8(string === undefined ? TYPE_INT_DEC : TYPE_STRING, 15);
    buffer.writeUInt32LE(string === undefined ? int : index(string), 16);
    return buffer;
  };
  const startElement = (name, attributes) => {
    const ext = Buffer.alloc(20);
    ext.writeUInt32LE(NO_INDEX, 0);
    ext.writeUInt32LE(index(name), 4);
    ext.writeUInt16LE(20, 8); // attributeStart
    ext.writeUInt16LE(20, 10); // attributeSize
    ext.writeUInt16LE(attributes.length, 12);
    return node(0x0102, Buffer.concat([ext, ...attributes.map(attribute)]));
  };
  const endElement = (name) => {
    const body = Buffer.alloc(8);
    body.writeUInt32LE(NO_INDEX, 0);
    body.writeUInt32LE(index(name), 4);
    return node(0x0103, body);
  };

  const body = Buffer.concat([
    stringPool(strings),
    chunk(0x0180, 8, resourceMap),
    namespace(0x0100),
    startElement("manifest", [
      { android: true, name: "versionCode", int: versionCode },
      { android: true, name: "versionName", string: versionName },
      { name: "package", string: packageName },
    ]),
    startElement("uses-sdk", [
      { android: true, name: "minSdkVersion", int: minSdk },
      { android: true, name: "targetSdkVersion", int: targetSdk },
    ]),
    endElement("uses-sdk"),
    ...permissions.flatMap((permission) => [
      startElement("uses-permission", [
        { android: true, name: "name", string: permission },
      ]),
      endElement("uses-permission"),
    ]),
    startElement("application", []),
    endElement("application"),
    endElement("manifest"),
    namespace(0x0101),
  ]);
  return chunk(0x0003, 8, body);
}

// ---- ZIP ---------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 一个伪造的 APK Signing Block：形状对（两个长度 + 魔数），内容不是真签名 */
function fakeSigningBlock() {
  const value = Buffer.from("not-a-real-signature");
  const pair = Buffer.alloc(12 + value.length);
  pair.writeBigUInt64LE(BigInt(4 + value.length), 0);
  pair.writeUInt32LE(0x7109871a, 8); // APK Signature Scheme v2 block id
  value.copy(pair, 12);
  const size = BigInt(pair.length + 8 + 16);
  const head = Buffer.alloc(8);
  head.writeBigUInt64LE(size, 0);
  const tail = Buffer.alloc(8);
  tail.writeBigUInt64LE(size, 0);
  return Buffer.concat([
    head,
    pair,
    tail,
    Buffer.from("APK Sig Block 42", "latin1"),
  ]);
}

/**
 * 条目是 `[name, content]` 或 `[name, content, { deflate: true }]`；
 * `signingBlock: true` 在中央目录前插一个签名块。
 */
function zipArchive(entries, { signingBlock = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content, { deflate = false } = {}] of entries) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const stored = deflate ? deflateRawSync(data) : data;
    const method = deflate ? 8 : 0;
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, stored);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + stored.length;
  }
  const block = signingBlock ? fakeSigningBlock() : Buffer.alloc(0);
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset + block.length, 16);
  return Buffer.concat([...locals, block, directory, end]);
}

/**
 * 一个“未签名 release 包”的合成品。`extraEntries` 可以塞 v1 签名文件之类的东西。
 */
function syntheticApk({
  packageName,
  versionCode = 1,
  versionName = "0.0.0-dev",
  permissions = [],
  appConfig = { extra: {} },
  extraEntries = [],
  signingBlock = false,
}) {
  return zipArchive(
    [
      [
        "AndroidManifest.xml",
        binaryManifest({ packageName, versionCode, versionName, permissions }),
      ],
      // 真实包里 app.config 是 DEFLATE 压缩的
      ["assets/app.config", JSON.stringify(appConfig), { deflate: true }],
      ["classes.dex", "dex\n035\0"],
      ...extraEntries,
    ],
    { signingBlock },
  );
}

// ---- 构建工具 ---------------------------------------------------------

/**
 * 真实的 build-tools 目录（含 apksigner、zipalign、aapt）。按顺序找：
 * `RN_TEST_ANDROID_BUILD_TOOLS`（直接指向某个版本目录）→ `ANDROID_HOME` / `ANDROID_SDK_ROOT`
 * 下 35 及以上版本号最高的那个（`zipalign -P` 从 35 开始才有）。找不到返回 null，
 * 依赖真工具的用例跳过。
 */
function realBuildTools() {
  const usable = (dir) =>
    ["apksigner", "zipalign", "aapt"].every((tool) =>
      existsSync(join(dir, tool)),
    );
  const direct = process.env.RN_TEST_ANDROID_BUILD_TOOLS;
  if (direct) return usable(direct) ? direct : null;
  for (const sdk of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT]) {
    if (!sdk || !existsSync(join(sdk, "build-tools"))) continue;
    const versions = readdirSync(join(sdk, "build-tools"))
      .filter((name) => /^\d+\.\d+\.\d+/.test(name))
      .filter((name) => Number(name.split(".")[0]) >= 35)
      .sort((left, right) =>
        right.localeCompare(left, undefined, { numeric: true }),
      );
    for (const version of versions) {
      const dir = join(sdk, "build-tools", version);
      if (usable(dir)) return dir;
    }
  }
  return null;
}

const hasJava = () =>
  spawnSync("keytool", ["-help"], { stdio: "ignore" }).status === 0 &&
  spawnSync("java", ["-version"], { stdio: "ignore" }).status === 0;

/**
 * 在 `root` 下搭一个假的 Android SDK：`build-tools/99.0.0/` 里的工具要么软链到真工具，
 * 要么是给定的 shell 脚本（用来模拟某个工具的输出）。返回 sdkRoot。
 */
function fakeSdk(root, { link = null, scripts = {} } = {}) {
  const dir = join(root, "sdk", "build-tools", "99.0.0");
  mkdirSync(dir, { recursive: true });
  if (link)
    for (const tool of ["apksigner", "zipalign", "aapt"])
      if (!(tool in scripts)) symlinkSync(join(link, tool), join(dir, tool));
  for (const [tool, body] of Object.entries(scripts))
    executable(join(dir, tool), body);
  return join(root, "sdk");
}

/** 写一个可执行的 shell 脚本（假的 pnpm、gradlew 之类）。 */
function executable(path, body) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

/** 模拟 `aapt dump badging` 的一行包信息 */
function fakeAaptScript({ packageName, versionCode = 1, versionName }) {
  return `echo "package: name='${packageName}' versionCode='${versionCode}' versionName='${versionName}'"`;
}

/**
 * 用真实工具给 APK 签名：现场生成一把 EC 测试密钥（口令走文件），zipalign 后 apksigner sign。
 * 只给测试用；返回签名证书的 SHA-256。
 */
function signWithFreshKey({ tools, workDir, input, output }) {
  const { randomBytes } = require("node:crypto");
  mkdirSync(workDir, { recursive: true });
  const password = join(workDir, "fixture.password");
  const keystore = join(workDir, "fixture.p12");
  writeFileSync(password, randomBytes(18).toString("base64url"), {
    mode: 0o600,
  });
  const run = (command, args) => {
    const result = spawnSync(command, args, { encoding: "utf8" });
    if (result.status !== 0)
      throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
    return result.stdout;
  };
  run("keytool", [
    "-genkeypair",
    "-keystore",
    keystore,
    "-storetype",
    "PKCS12",
    "-alias",
    "fixture",
    "-keyalg",
    "EC",
    "-groupname",
    "secp256r1",
    "-validity",
    "30",
    "-dname",
    "CN=fixture",
    "-storepass:file",
    password,
    "-keypass:file",
    password,
  ]);
  const aligned = join(workDir, "fixture-aligned.apk");
  run(join(tools, "zipalign"), ["-f", "-P", "16", "4", input, aligned]);
  run(join(tools, "apksigner"), [
    "sign",
    "--ks",
    keystore,
    "--ks-key-alias",
    "fixture",
    "--ks-pass",
    `file:${password}`,
    "--v4-signing-enabled",
    "false",
    "--out",
    output,
    aligned,
  ]);
  const printed = run(join(tools, "apksigner"), [
    "verify",
    "--print-certs",
    output,
  ]);
  return /certificate SHA-256 digest: ([0-9a-f]{64})/.exec(printed)[1];
}

module.exports = {
  binaryManifest,
  executable,
  fakeAaptScript,
  fakeSdk,
  hasJava,
  realBuildTools,
  signWithFreshKey,
  syntheticApk,
  zipArchive,
};
