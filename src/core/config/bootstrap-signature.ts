import {
  decodeBase64,
  getAddress,
  hexlify,
  toUtf8Bytes,
  verifyMessage,
} from "ethers";

/**
 * bootstrap 响应签名的客户端判定（安全评审 N3）。
 *
 * bootstrap 决定 RPC 端点、预测平台域名与 scopeId、更新策略、直装下载地址。
 * 在此之前它的真实性只到 TLS 为止：控制了服务端或拿到一张被信任的恶意 CA 的人，
 * 不用碰 OTA 就能把设备指向自己的节点。
 *
 * 验的是**收到的那串原始字节**，在 JSON.parse 之前。先解析再验等于给自己留一个
 * "解析过程改写了什么"的缺口，而那正是签名要覆盖的范围。
 *
 * 用 ethers 的 verifyMessage：secp256k1 + EIP-191 信封，是这个钱包**已经拿用户
 * 资金在信任**的那份实现。为此引一个 RSA 验证器或一条新曲线，等于在最敏感的位置
 * 增加一份没人审过的代码。
 */

/** 服务端那条头的算法标识。只认这一个：我们只签这一种。 */
export const BOOTSTRAP_SIGNATURE_ALGORITHM = "secp256k1-eip191-keccak256";

export class BootstrapSignatureError extends Error {
  constructor(reason: string) {
    super(`bootstrap signature rejected: ${reason}`);
    this.name = "BootstrapSignatureError";
  }
}

type SignatureHeader = { sig: string; keyid: string; alg: string };

/**
 * 解析 RFC 8941 字典（`sig="..", keyid="..", alg=".."`）。
 * 三个值都是 sf-string：带引号，`\"` 与 `\\` 是转义。
 */
export function parseSignatureHeader(header: string): SignatureHeader | null {
  const fields: Record<string, string> = {};
  const pattern = /([a-z][a-z0-9_-]*)="((?:[^"\\]|\\.)*)"/gi;
  for (const match of header.matchAll(pattern)) {
    fields[match[1]!.toLowerCase()] = match[2]!.replace(/\\(.)/g, "$1");
  }
  const { sig, keyid, alg } = fields;
  if (!sig || !keyid || !alg) return null;
  return { sig, keyid, alg };
}

/**
 * 验签。不匹配一律抛 `BootstrapSignatureError`——这是 fail closed 的：宁可停在
 * 启动门禁，也不能拿一份来路不明的配置去连 RPC、去签授权。
 */
export function verifyBootstrapSignature(input: {
  body: string;
  header: string;
  signerAddress: string;
}): void {
  const parsed = parseSignatureHeader(input.header);
  if (!parsed) throw new BootstrapSignatureError("header is malformed");
  if (parsed.alg !== BOOTSTRAP_SIGNATURE_ALGORITHM)
    throw new BootstrapSignatureError(`unexpected algorithm ${parsed.alg}`);

  let expected: string;
  try {
    expected = getAddress(input.signerAddress);
  } catch {
    throw new BootstrapSignatureError(
      "pinned signer address is not an address",
    );
  }

  let recovered: string;
  try {
    // base64 → hex。用 ethers 自带的解码，不依赖 Hermes 有没有 atob。
    recovered = verifyMessage(
      toUtf8Bytes(input.body),
      hexlify(decodeBase64(parsed.sig)),
    );
  } catch (error) {
    throw new BootstrapSignatureError(
      `signature does not recover an address (${error instanceof Error ? error.name : "unknown"})`,
    );
  }
  if (recovered !== expected)
    throw new BootstrapSignatureError(
      `signed by ${recovered}, expected ${expected}`,
    );
}

/**
 * 重放判定。签名挡不住"把昨天那份**合法**响应再发一遍"，从而把强制升级、灰度
 * 名单或链配置回滚回旧值。记住见过的最大 `issuedAt`，更小的一律拒绝。
 *
 * 容差是给多实例之间的时钟偏差留的，不是给攻击者留的：一份真正的旧响应会差上
 * 几小时甚至几天，不会差几秒。
 */
export const ISSUED_AT_TOLERANCE_MS = 30_000;

export function isReplayed(issuedAt: number, highestSeen: number): boolean {
  if (!Number.isFinite(issuedAt)) return false;
  return issuedAt < highestSeen - ISSUED_AT_TOLERANCE_MS;
}
