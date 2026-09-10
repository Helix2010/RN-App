import { LangEn, randomBytes } from "ethers";

/**
 * 备份校验题的出题逻辑（安全评审 N25）。
 *
 * 为什么不用固定 seed：位置和干扰词一旦是常量，同一台设备上每次备份考的都是
 * 同样那三个位置、同样那三个干扰词。旁观者看一次就知道下次考哪几个，"抄写后
 * 校验"这一步就只是走过场。这里用 CSPRNG 出题，并把随机源做成可注入的，
 * 测试才能确定性地断言。
 */

const wordlist = LangEn.wordlist();
const WORDLIST_SIZE = 2048;

/** `[0, maxExclusive)` 上的均匀随机整数。 */
export type RandomInt = (maxExclusive: number) => number;

/**
 * 默认随机源：CSPRNG + 拒绝采样。
 * 直接取模会让前几个值多出现一次（模偏差），题目分布就不均匀了。
 */
export const cryptoRandomInt: RandomInt = (maxExclusive) => {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1)
    throw new Error(`random bound must be a positive integer: ${maxExclusive}`);
  if (maxExclusive === 1) return 0;
  const limit = Math.floor(0x100000000 / maxExclusive) * maxExclusive;
  for (;;) {
    const bytes = randomBytes(4);
    const value =
      ((bytes[0] as number) << 24) |
      ((bytes[1] as number) << 16) |
      ((bytes[2] as number) << 8) |
      (bytes[3] as number);
    const unsigned = value >>> 0;
    if (unsigned < limit) return unsigned % maxExclusive;
  }
};

/** Fisher–Yates 洗牌；随机源可注入。 */
export function shuffle<T>(items: T[], randomInt: RandomInt): T[] {
  const list = [...items];
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [list[index], list[swap]] = [list[swap] as T, list[index] as T];
  }
  return list;
}

/** 随机挑 `count` 个要考的位置，升序返回（按抄写顺序问，用户不用来回找）。 */
export function pickTargets(
  wordCount: number,
  count: number,
  randomInt: RandomInt,
): number[] {
  if (count > wordCount)
    throw new Error(`cannot pick ${count} targets out of ${wordCount} words`);
  return shuffle([...Array(wordCount).keys()], randomInt)
    .slice(0, count)
    .sort((left, right) => left - right);
}

/** 干扰词取自真实 BIP-39 词表，不与正确答案重复。 */
export function decoysFor(
  word: string,
  count: number,
  randomInt: RandomInt,
): string[] {
  const picks: string[] = [];
  while (picks.length < count) {
    const candidate = wordlist.getWord(randomInt(WORDLIST_SIZE));
    if (candidate !== word && !picks.includes(candidate)) picks.push(candidate);
  }
  return picks;
}

/**
 * 出一整套题：每个被考位置给出「正确答案 + 干扰词」的乱序选项。
 * 词还没解封（`words` 为空）时返回空表，调用方不渲染选项。
 */
export function buildQuiz(
  words: string[],
  options: { targetCount: number; decoyCount: number; randomInt?: RandomInt },
): { targets: number[]; choices: Record<number, string[]> } {
  const randomInt = options.randomInt ?? cryptoRandomInt;
  if (words.length === 0) return { targets: [], choices: {} };
  const targets = pickTargets(words.length, options.targetCount, randomInt);
  const choices: Record<number, string[]> = {};
  for (const index of targets) {
    const word = words[index] as string;
    choices[index] = shuffle(
      [word, ...decoysFor(word, options.decoyCount, randomInt)],
      randomInt,
    );
  }
  return { targets, choices };
}

/** 连续答错这么多次就退回抄写页重看，不让用户在选项里穷举。 */
export const MAX_QUIZ_ATTEMPTS = 3;
