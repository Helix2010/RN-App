import {
  MAX_QUIZ_ATTEMPTS,
  buildQuiz,
  cryptoRandomInt,
  decoysFor,
  pickTargets,
  shuffle,
} from "./backup-quiz";

/** 确定性随机源：按给定序列出数，用尽后从头再来。 */
function sequence(values: number[]) {
  let cursor = 0;
  return (maxExclusive: number) => {
    const value = values[cursor % values.length] as number;
    cursor += 1;
    return value % maxExclusive;
  };
}

const WORDS =
  "abandon ability able about above absent absorb abstract absurd abuse access accident".split(
    " ",
  );

describe("backup quiz", () => {
  it("asks about different positions on different draws", () => {
    const draws = new Set<string>();
    for (let round = 0; round < 40; round += 1)
      draws.add(pickTargets(12, 3, cryptoRandomInt).join(","));
    // 固定 seed 的旧实现每次都出同一组；随机出题 40 次不可能只有一种组合
    expect(draws.size).toBeGreaterThan(5);
  });

  it("keeps the asked positions in writing order", () => {
    const targets = pickTargets(12, 3, cryptoRandomInt);
    expect(targets).toHaveLength(3);
    expect([...targets].sort((a, b) => a - b)).toEqual(targets);
    expect(new Set(targets).size).toBe(3);
  });

  it("refuses to ask about more positions than there are words", () => {
    expect(() => pickTargets(3, 4, cryptoRandomInt)).toThrow(/cannot pick/);
  });

  it("never offers the right answer twice as a decoy", () => {
    for (let round = 0; round < 50; round += 1) {
      const decoys = decoysFor("abandon", 3, cryptoRandomInt);
      expect(decoys).toHaveLength(3);
      expect(decoys).not.toContain("abandon");
      expect(new Set(decoys).size).toBe(3);
    }
  });

  it("puts the right answer somewhere among the options", () => {
    const { targets, choices } = buildQuiz(WORDS, {
      targetCount: 3,
      decoyCount: 3,
      randomInt: sequence([5, 2, 9, 1, 7, 3]),
    });
    for (const index of targets) {
      const options = choices[index] as string[];
      expect(options).toHaveLength(4);
      expect(options).toContain(WORDS[index]);
    }
  });

  it("returns an empty quiz while the phrase is still locked", () => {
    expect(buildQuiz([], { targetCount: 3, decoyCount: 3 })).toEqual({
      targets: [],
      choices: {},
    });
  });

  it("shuffles without dropping or duplicating items", () => {
    const shuffled = shuffle([1, 2, 3, 4, 5], cryptoRandomInt);
    expect([...shuffled].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it("draws uniformly enough that no value is starved", () => {
    const counts = new Map<number, number>();
    for (let round = 0; round < 3000; round += 1) {
      const value = cryptoRandomInt(3);
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    expect(counts.size).toBe(3);
    for (const count of counts.values()) expect(count).toBeGreaterThan(700);
  });

  it("rejects a nonsensical bound instead of returning a wrong index", () => {
    expect(() => cryptoRandomInt(0)).toThrow(/positive integer/);
  });

  it("sends the user back to re-read after three wrong answers", () => {
    expect(MAX_QUIZ_ATTEMPTS).toBe(3);
  });
});
