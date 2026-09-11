import { LangEn } from "ethers";

/**
 * 外泄出口上的秘密扫描（安全评审 §12.2「日志、崩溃、分析和客服采集做 canary
 * secret 扫描；发现 mnemonic/private key/pairing URI 即阻断」）。
 *
 * ESLint 那条规则只管得住"有人直接把 phrase 写进 console.*"。真正会出事的是
 * 拼起来的那种：一个异常的 message 里带上了助记词，崩溃诊断把它和
 * componentStack 一起拼成一段文本，用户点"复制"发给客服——每一步都没有人
 * 写过 `console.log(phrase)`，但助记词还是出去了。
 *
 * ## 为什么不按"64 位十六进制"去找私钥
 *
 * 私钥、交易哈希、区块哈希、EIP-712 摘要、WalletConnect 的 symKey、scopeId，
 * 形状**完全一样**都是 `0x` + 64 hex。这个应用的诊断信息里交易哈希遍地都是，
 * 按形状拦截等于把正常诊断全打上马赛克，最后没人再看诊断。
 *
 * 所以这里只做两类**高精度**判定，外加一个显式登记的 canary 名单：
 *
 * - **助记词**：连续 12 个以上的词全部落在 BIP-39 英文词表里。词表只有 2048 个
 *   常用短词，但连续十二个英文单词恰好全在表内的概率低到可以忽略——误报率足够
 *   低，可以直接阻断。为什么是"12 个以上"而不是"恰好 12/15/18/21/24 个"，见
 *   `MIN_MNEMONIC_WORDS`。
 * - **WalletConnect 配对 URI**：`wc:` 前缀 + `symKey=`，形状独特。拿到它等于
 *   拿到会话对称密钥。
 * - **canary**：开发/预发构建里种进去的已知值。形状判定不了的东西（私钥就是
 *   典型）靠它兜底：值是我们自己种的，出现即精确命中，零误报。
 */

const wordlist = LangEn.wordlist();

/**
 * 连续多少个词表内的词就当成助记词。
 *
 * **不能要求"恰好 12 / 15 / 18 / 21 / 24 个"**：助记词旁边的词很可能也在表里，
 * 一挨上长度就不再是合法值，判定直接失效。实测的例子——`phrase: <12 个词>`，
 * 而 `phrase` 本身就在 BIP-39 词表里，于是连续长度是 13，按"恰好"判定漏掉，
 * 而这恰恰是最典型的泄漏形状。
 *
 * 所以只看下限，并且命中后把整段连续词一起遮蔽。多盖掉几个挨着的普通单词，
 * 比漏掉一整句助记词划算得多。
 */
const MIN_MNEMONIC_WORDS = 12;

export type SecretKind = "mnemonic" | "pairing-uri" | "canary";

/** 命中后替换成这个，保留"这里原本有东西"的信息但不保留内容。 */
export const REDACTED = "[redacted:secret]";

/**
 * 已登记的 canary 值。
 *
 * 开发与预发构建在启动时把测试助记词、测试私钥登记进来，之后任何出口上出现
 * 它们都会被拦下并报出来。生产构建不登记任何值——canary 是验证手段，不是防线，
 * 防线是上面那两个形状判定。
 */
const canaries = new Set<string>();

/**
 * 登记一个 canary。太短的值不收：`0x` 或几个字符会命中一切，把扫描变成噪声。
 */
export function registerSecretCanary(value: string): void {
  const trimmed = value.trim();
  if (trimmed.length >= 16) canaries.add(trimmed);
}

/** 仅供测试与构建切换：清空 canary 名单。 */
export function resetSecretCanaries(): void {
  canaries.clear();
}

/** 文本里连续落在 BIP-39 词表内、且长到足以是助记词的那些片段。 */
function mnemonicRanges(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let runStart = -1;
  let runEnd = -1;
  let runLength = 0;
  const flush = (): void => {
    if (runLength >= MIN_MNEMONIC_WORDS)
      ranges.push({ start: runStart, end: runEnd });
    runStart = -1;
    runEnd = -1;
    runLength = 0;
  };
  for (const token of text.matchAll(/[A-Za-z]+/g)) {
    const index = token.index ?? 0;
    if (wordlist.getWordIndex(token[0].toLowerCase()) >= 0) {
      if (runLength === 0) runStart = index;
      runLength += 1;
      runEnd = index + token[0].length;
    } else {
      flush();
    }
  }
  flush();
  return ranges;
}

/** WalletConnect 配对 URI：`wc:<topic>@2?...symKey=<hex>`。 */
const PAIRING_URI = /wc:[0-9a-fA-F]{8,}@\d+\?[^\s"']*symKey=[0-9a-fA-F]+/g;

/**
 * 这段文本里有哪几类秘密。返回空数组表示没看出问题——**没看出不等于没有**，
 * 调用方该按"尽力而为的最后一道"来理解它，而不是当成许可。
 */
export function findSecrets(text: string): SecretKind[] {
  const kinds = new Set<SecretKind>();
  if (mnemonicRanges(text).length > 0) kinds.add("mnemonic");
  if (PAIRING_URI.test(text)) kinds.add("pairing-uri");
  PAIRING_URI.lastIndex = 0;
  for (const value of canaries)
    if (text.includes(value)) {
      kinds.add("canary");
      break;
    }
  return [...kinds];
}

/**
 * 把命中的部分换成 `[redacted:secret]`，其余原样保留。
 *
 * 为什么是遮蔽而不是整段丢弃：崩溃诊断的价值在于让客服和工程师看懂发生了什么，
 * 因为一行里混进了助记词就把整段扔掉，等于把这条排查路径也一起关掉。
 */
export function redactSecrets(text: string): string {
  let result = text;
  for (const value of canaries)
    if (value) result = result.split(value).join(REDACTED);
  result = result.replace(PAIRING_URI, REDACTED);
  PAIRING_URI.lastIndex = 0;
  // 助记词从后往前替换，避免前面的替换把后面的区间位置挪掉
  const ranges = mnemonicRanges(result);
  for (const { start, end } of [...ranges].reverse())
    result = `${result.slice(0, start)}${REDACTED}${result.slice(end)}`;
  return result;
}
