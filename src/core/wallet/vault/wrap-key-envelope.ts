import { gcm } from "@noble/ciphers/aes.js";
import { randomBytes } from "ethers";
import { fromBase64, toBase64 } from "./base64";
import {
  DEFAULT_SCRYPT,
  WalletPassphraseError,
  assertScryptParams,
  derivePassphraseKey,
  newPassphraseSalt,
  passphraseCheck,
  type ScryptParams,
} from "./passphrase";

/**
 * 包裹密钥 WK 的第二份封装（安全评审 N6 / 方案 §3.5 的「B 路」）。
 *
 * WK 同时存两份，互相独立：
 *
 *   A 路  SecureStore 条目，requireAuthentication: true。快路径，读它会弹系统
 *         验证，JS 伪造不了也绕不开。**操作系统可以在任何时候作废它**：Android 上
 *         新录一枚指纹或换掉锁屏就会，iOS 上生物识别集合变化就会。
 *   B 路  就是这个文件。永不被作废，是 A 路被作废之后唯一的恢复路径，也是设备
 *         没录入生物识别时唯一的路径。
 *
 * **没有 B 路就不能开 A 路。** 把认证绑定的密钥当成 WK 的唯一副本，等于给每个用户
 * 装一枚随时可能触发、会永久销毁钱包的开关，而绝大多数人不会在那之前认真抄下
 * 助记词。这不是小概率事件，是必然会发生在一部分用户身上的事件。
 *
 * 双层封装：
 *
 *   内层  AES-256-GCM(WK, key = scrypt(口令))     —— 防拿到 JS 执行权的攻击者
 *   外层  AES-256-GCM(内层, key = 未认证的设备密钥) —— 防把存储整个捞走的人
 *
 * 外层防的是另一类人：adb 备份、云备份、某天不小心把存储打进日志。单独一份信封
 * 离开这台设备之后毫无用处。与服务端 keystore 的双层封装同一个思路（内层操作者
 * 口令，外层服务端主密钥）。
 */

const NONCE_LENGTH = 12;
const OUTER_AAD = new TextEncoder().encode("foundation.wallet.wrap-key.v1");

export type WrapKeyEnvelope = {
  version: 1;
  kdf: { salt: string; N: number; r: number; p: number };
  /** 口令校验值：输错时报"口令不对"，而不是一个笼统的解密失败 */
  check: string;
  nonce: string;
  ciphertext: string;
};

export class WrapKeyEnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WrapKeyEnvelopeError";
  }
}

/** 设备密钥：外层用的那把，存未认证的 SecureStore。 */
export function newDeviceKey(): Uint8Array {
  return randomBytes(32);
}

function kdfAad(kdf: WrapKeyEnvelope["kdf"]): Uint8Array {
  // 单射编码：参数被改（比如 N 被调小）会让内层解密直接失败，而不是悄悄按弱参数走
  return new TextEncoder().encode(
    JSON.stringify(["v1", kdf.salt, kdf.N, kdf.r, kdf.p]),
  );
}

/**
 * 封好一份信封，并把**派生出来的口令密钥一起交出去**。
 *
 * 交出去不是图省事：scrypt 是故意做得很慢的，在手机的 JS 引擎上一次要以秒计。
 * 开启口令这条路上要用到同一把密钥三次（加密、读回来核对、重新加密助记词），
 * 各自再派生一遍就是三倍的等待——实测里那正好把按钮卡成"按了没反应"。
 *
 * **调用方负责 wipe 这把密钥。**
 */
export async function sealWrapKey(input: {
  wrapKey: Uint8Array;
  passphrase: string;
  deviceKey: Uint8Array;
  params?: ScryptParams;
}): Promise<{ envelope: WrapKeyEnvelope; passKey: Uint8Array }> {
  const params = input.params ?? DEFAULT_SCRYPT;
  const salt = newPassphraseSalt();
  const passKey = await derivePassphraseKey(input.passphrase, salt, params);
  const kdf = { salt: toBase64(salt), N: params.N, r: params.r, p: params.p };

  const innerNonce = randomBytes(NONCE_LENGTH);
  const inner = gcm(passKey, innerNonce, kdfAad(kdf)).encrypt(input.wrapKey);
  // 内层的 nonce 跟着内层走，外层只看见一整块
  const innerBlob = new Uint8Array(innerNonce.length + inner.length);
  innerBlob.set(innerNonce, 0);
  innerBlob.set(inner, innerNonce.length);

  const outerNonce = randomBytes(NONCE_LENGTH);
  const outer = gcm(input.deviceKey, outerNonce, OUTER_AAD).encrypt(innerBlob);

  innerBlob.fill(0);
  return {
    envelope: {
      version: 1,
      kdf,
      // 校验值用**同一把**已经派生好的密钥算，不要为了它再跑一遍 scrypt
      check: passphraseCheck(passKey),
      nonce: toBase64(outerNonce),
      ciphertext: toBase64(outer),
    },
    passKey,
  };
}

export async function openWrapKey(input: {
  envelope: WrapKeyEnvelope;
  passphrase: string;
  deviceKey: Uint8Array;
}): Promise<Uint8Array> {
  const passKey = await derivePassKeyFor(input.envelope, input.passphrase);
  try {
    return openWrapKeyWith(input.envelope, passKey, input.deviceKey);
  } finally {
    passKey.fill(0);
  }
}

/**
 * 已经有口令密钥时用这个，不再跑 scrypt。刚封好就要读回来核对的那一步走这里——
 * 那一步的目的是"封装写对了吗"，不是"用户的口令对吗"。
 */
export function openWrapKeyWith(
  envelope: WrapKeyEnvelope,
  passKey: Uint8Array,
  deviceKey: Uint8Array,
): Uint8Array {
  if (envelope.version !== 1)
    throw new WrapKeyEnvelopeError("unknown envelope version");
  const params = { N: envelope.kdf.N, r: envelope.kdf.r, p: envelope.kdf.p };
  // 参数来自本地存储，能改存储的人就能把强度调下去；不接受比下限弱的
  assertScryptParams(params);
  if (passphraseCheck(passKey) !== envelope.check)
    throw new WalletPassphraseError("passphrase does not match this wallet");

  const input = { envelope, deviceKey };
  let innerBlob: Uint8Array;
  try {
    innerBlob = gcm(
      input.deviceKey,
      fromBase64(envelope.nonce),
      OUTER_AAD,
    ).decrypt(fromBase64(envelope.ciphertext));
  } catch {
    // 外层打不开 = 设备密钥不对或信封坏了。**与口令无关**，不要报成口令错。
    throw new WrapKeyEnvelopeError("envelope cannot be opened on this device");
  }

  try {
    const nonce = innerBlob.slice(0, NONCE_LENGTH);
    const ciphertext = innerBlob.slice(NONCE_LENGTH);
    return gcm(passKey, nonce, kdfAad(envelope.kdf)).decrypt(ciphertext);
  } catch {
    // 口令已经对上了，还解不开 = 内容真的坏了。这两种要分得开，用户才知道
    // 自己该重输还是该走恢复。
    throw new WrapKeyEnvelopeError("envelope contents are damaged");
  } finally {
    innerBlob.fill(0);
  }
}

/**
 * 由信封里的参数 + 用户口令派生出口令密钥，并核对校验值。
 *
 * 助记词条目要的就是这把（`HKDF(WK ‖ 这把)`），而它不能从已经解开的 WK 反推——
 * 那样的话拿到 WK 就等于拿到助记词，这次拆分的意义就没了。
 */
export async function derivePassKeyFor(
  envelope: WrapKeyEnvelope,
  passphrase: string,
): Promise<Uint8Array> {
  if (envelope.version !== 1)
    throw new WrapKeyEnvelopeError("unknown envelope version");
  const params = { N: envelope.kdf.N, r: envelope.kdf.r, p: envelope.kdf.p };
  assertScryptParams(params);
  const key = await derivePassphraseKey(
    passphrase,
    fromBase64(envelope.kdf.salt),
    params,
  );
  if (passphraseCheck(key) !== envelope.check) {
    key.fill(0);
    throw new WalletPassphraseError("passphrase does not match this wallet");
  }
  return key;
}
