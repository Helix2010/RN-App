import {
  HDNodeWallet,
  Mnemonic,
  Wallet,
  getAddress,
  isHexString,
  randomBytes,
} from "ethers";

/**
 * BIP-39 助记词与 BIP-44 派生。只用 ethers 自带的审计实现（secp256k1 走 RFC6979
 * 确定性 nonce），不自研任何密码学。随机数来自 crypto.getRandomValues，RN 侧由
 * react-native-get-random-values 提供 CSPRNG。
 */

/** BIP-44 EVM 账户路径前缀；`${EVM_ACCOUNT_PATH}/${index}` 是第 index 个地址。 */
export const EVM_ACCOUNT_PATH = "m/44'/60'/0'/0";

type DerivedAccount = {
  address: string;
  privateKey: string;
  path: string | null;
};

export function evmPath(index: number): string {
  if (!Number.isInteger(index) || index < 0)
    throw new Error("derivation index must be a non-negative integer");
  return `${EVM_ACCOUNT_PATH}/${index}`;
}

/** 助记词词数。12 词 = 128 位熵，24 词 = 256 位。 */
export type MnemonicWordCount = 12 | 24;

/**
 * 新钱包**默认 24 词**（安全评审 N29）。默认给强的那个，需要好抄的人自己在界面
 * 上降级——反过来（默认给弱的、把强的藏进高级设置）等于让绝大多数人拿到较弱的
 * 那一个。导入不受影响，两种一直都收。
 */
export const DEFAULT_MNEMONIC_WORDS: MnemonicWordCount = 24;

const ENTROPY_BYTES: Record<MnemonicWordCount, number> = { 12: 16, 24: 32 };

export function generateMnemonic(
  words: MnemonicWordCount = DEFAULT_MNEMONIC_WORDS,
): string {
  const bytes = ENTROPY_BYTES[words];
  if (!bytes) throw new Error("mnemonic word count must be 12 or 24");
  return Mnemonic.fromEntropy(randomBytes(bytes)).phrase;
}

/** 一句助记词有多少个词。备份页要按它画格子，不能再写死 12。 */
export function wordCountOf(phrase: string): number {
  const normalized = normalizeMnemonic(phrase);
  return normalized === "" ? 0 : normalized.split(" ").length;
}

/** 去掉多余空白并转小写；BIP-39 词表全小写，用户粘贴常带大写和换行。 */
export function normalizeMnemonic(phrase: string): string {
  return phrase.trim().toLowerCase().split(/\s+/).join(" ");
}

export function isValidMnemonic(phrase: string): boolean {
  const normalized = normalizeMnemonic(phrase);
  if (normalized === "") return false;
  return Mnemonic.isValidMnemonic(normalized);
}

export function deriveAccount(phrase: string, index = 0): DerivedAccount {
  const normalized = normalizeMnemonic(phrase);
  if (!Mnemonic.isValidMnemonic(normalized))
    throw new Error("invalid mnemonic phrase");
  const wallet = HDNodeWallet.fromPhrase(normalized, undefined, evmPath(index));
  return {
    address: getAddress(wallet.address),
    privateKey: wallet.privateKey,
    path: wallet.path,
  };
}

export function normalizePrivateKey(key: string): string {
  const trimmed = key.trim();
  return trimmed.startsWith("0x") || trimmed.startsWith("0X")
    ? `0x${trimmed.slice(2).toLowerCase()}`
    : `0x${trimmed.toLowerCase()}`;
}

export function isValidPrivateKey(key: string): boolean {
  const normalized = normalizePrivateKey(key);
  if (!isHexString(normalized, 32)) return false;
  try {
    new Wallet(normalized);
    return true;
  } catch {
    return false;
  }
}

export function accountFromPrivateKey(key: string): DerivedAccount {
  const normalized = normalizePrivateKey(key);
  if (!isValidPrivateKey(normalized)) throw new Error("invalid private key");
  const wallet = new Wallet(normalized);
  return {
    address: getAddress(wallet.address),
    privateKey: normalized,
    path: null,
  };
}
