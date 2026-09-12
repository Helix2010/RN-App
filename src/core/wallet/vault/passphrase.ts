import { scryptAsync } from "@noble/hashes/scrypt.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "ethers";
import { toBase64 } from "./base64";

/**
 * 钱包口令：金库的第二把钥匙（安全评审 N6 / 方案 §3.6）。
 *
 * 它挡的不是"能读 JS 堆的攻击者"——在 JS 里那做不到。它把**静默的、一次性的、
 * 永久的窃取**降级成**必须骗到用户口令的窃取**：前者零弹窗、零痕迹、拿走的是
 * 全部未来资金；后者要用户动手，会失败，用户看得见。
 *
 * 所以不要为口令强度设计苛刻规则。口令的职责是让窃取变成交互式的，不是让它扛住
 * 离线爆破——真正扛离线爆破的是把密文留在设备上的那层（见 vault 的 B 路封装）。
 */

/**
 * scrypt 参数。**这组数是实测出来的，不是拍的。**
 *
 * 2026-09-12 在 Android 模拟器（sdk_gphone64_x86_64）上用发布包量过：
 *
 * | N     | 内存  | 一次派生 |
 * | ----- | ----- | -------- |
 * | 2^14  | 16MiB | 约 20 秒 |
 * | 2^13  | 8MiB  | 约 10 秒 |
 *
 * 纯 JS 的 scrypt 跑在 Hermes 上没有 JIT，比 Node 慢两个数量级（Node 上 2^15 只要
 * 90 毫秒）。服务端 keystore 用的 2^16 在手机上完全不能用，不要照抄。
 *
 * 取 2^13：需要口令的都是低频、用户主动发起的动作——开启口令、查看助记词、系统
 * 作废密钥后的恢复。日常签名走认证绑定的那条路，根本不碰 scrypt。真要更快只能把
 * KDF 搬到原生，那是另一件事。
 */
export const DEFAULT_SCRYPT = { N: 2 ** 13, r: 8, p: 1 } as const;

/** 低于这组参数的存量信封不再接受：不能让攻破者把强度调下去再存回来。 */
export const MIN_SCRYPT = { N: 2 ** 13, r: 8, p: 1 } as const;

export type ScryptParams = { N: number; r: number; p: number };

/** 口令长度下限。见文件头：不要往上堆规则。 */
export const MIN_PASSPHRASE_LENGTH = 8;

const KEY_LENGTH = 32;
const CHECK_SALT = new TextEncoder().encode("foundation.wallet.passphrase.v1");
const CHECK_LENGTH = 8;

export class WalletPassphraseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletPassphraseError";
  }
}

export function isPassphraseAcceptable(passphrase: string): boolean {
  return passphrase.length >= MIN_PASSPHRASE_LENGTH;
}

export function assertPassphraseAcceptable(passphrase: string): void {
  if (!isPassphraseAcceptable(passphrase))
    throw new WalletPassphraseError(
      `passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`,
    );
}

export function newPassphraseSalt(): Uint8Array {
  return randomBytes(16);
}

/** 参数不能比下限弱。存量信封里的参数来自本地存储，能改存储的人就能改它。 */
export function assertScryptParams(params: ScryptParams): void {
  if (
    !Number.isInteger(params.N) ||
    params.N < MIN_SCRYPT.N ||
    params.r < MIN_SCRYPT.r ||
    params.p < MIN_SCRYPT.p
  )
    throw new WalletPassphraseError("passphrase KDF parameters are too weak");
}

/**
 * 由口令派生 32 字节密钥。用 scryptAsync 而不是 scrypt：同步版本会把 JS 线程
 * 卡住一到几秒，用户看到的是整个界面冻住。
 */
export async function derivePassphraseKey(
  passphrase: string,
  salt: Uint8Array,
  params: ScryptParams = DEFAULT_SCRYPT,
): Promise<Uint8Array> {
  assertScryptParams(params);
  return scryptAsync(passphrase, salt, { ...params, dkLen: KEY_LENGTH });
}

/**
 * 校验值：口令输错时报"口令不对"，而不是报一个 GCM 认证失败。
 *
 * 这一点与服务端 keystore 的做法**相反**——那边故意让"口令错"和"内容坏"返回
 * 同一个错误，以免形成判决神谕。这里威胁模型不同：用户必须知道自己是打错了字
 * 还是数据坏了，而攻击者本来就能自己试。这个差异是有意的，不要"统一"掉。
 */
export function passphraseCheck(key: Uint8Array): string {
  const digest = hkdf(sha256, key, CHECK_SALT, undefined, CHECK_LENGTH);
  return toBase64(digest);
}
