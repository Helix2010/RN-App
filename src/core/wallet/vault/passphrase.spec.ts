import {
  DEFAULT_SCRYPT,
  MIN_PASSPHRASE_LENGTH,
  WalletPassphraseError,
  assertPassphraseAcceptable,
  assertScryptParams,
  derivePassphraseKey,
  isPassphraseAcceptable,
  newPassphraseSalt,
  passphraseCheck,
} from "./passphrase";

// 单测里用最低合法参数，不然每个用例都要等 scrypt 跑完 32 MiB
const FAST = { N: 2 ** 14, r: 8, p: 1 };

describe("derivePassphraseKey", () => {
  it("同口令同盐得到同一把密钥", async () => {
    const salt = newPassphraseSalt();
    const first = await derivePassphraseKey("correct horse", salt, FAST);
    const second = await derivePassphraseKey("correct horse", salt, FAST);

    expect(first).toHaveLength(32);
    expect(Array.from(first)).toEqual(Array.from(second));
  });

  it("换口令或换盐都得到不同的密钥", async () => {
    const salt = newPassphraseSalt();
    const base = await derivePassphraseKey("correct horse", salt, FAST);
    const otherPassphrase = await derivePassphraseKey(
      "correct horsf",
      salt,
      FAST,
    );
    const otherSalt = await derivePassphraseKey(
      "correct horse",
      newPassphraseSalt(),
      FAST,
    );

    expect(Array.from(otherPassphrase)).not.toEqual(Array.from(base));
    expect(Array.from(otherSalt)).not.toEqual(Array.from(base));
  });

  it("盐每次都不同，否则同口令的两台设备落同一把密钥", () => {
    expect(Array.from(newPassphraseSalt())).not.toEqual(
      Array.from(newPassphraseSalt()),
    );
  });
});

describe("assertScryptParams", () => {
  it("接受默认参数", () => {
    expect(() => assertScryptParams(DEFAULT_SCRYPT)).not.toThrow();
  });

  it("拒绝被调弱的参数——能改本地存储的人就能改它", () => {
    for (const weak of [
      { N: 2 ** 10, r: 8, p: 1 },
      { N: 2 ** 15, r: 1, p: 1 },
      { N: 2 ** 15, r: 8, p: 0 },
      { N: 1.5, r: 8, p: 1 },
    ]) {
      expect(() => assertScryptParams(weak)).toThrow(WalletPassphraseError);
    }
  });

  it("派生时也会挡住弱参数，不只是存的时候", async () => {
    await expect(
      derivePassphraseKey("x", newPassphraseSalt(), { N: 2, r: 1, p: 1 }),
    ).rejects.toThrow(WalletPassphraseError);
  });
});

describe("passphraseCheck", () => {
  it("认得出同一把密钥，也认得出不是同一把", async () => {
    const salt = newPassphraseSalt();
    const right = await derivePassphraseKey("correct horse", salt, FAST);
    const wrong = await derivePassphraseKey("battery staple", salt, FAST);

    expect(passphraseCheck(right)).toBe(
      passphraseCheck(await derivePassphraseKey("correct horse", salt, FAST)),
    );
    expect(passphraseCheck(wrong)).not.toBe(passphraseCheck(right));
  });

  it("校验值不是密钥本身", async () => {
    const key = await derivePassphraseKey(
      "correct horse",
      newPassphraseSalt(),
      FAST,
    );
    expect(passphraseCheck(key).length).toBeLessThan(20);
  });
});

describe("口令强度", () => {
  it("太短就拒", () => {
    expect(isPassphraseAcceptable("a".repeat(MIN_PASSPHRASE_LENGTH - 1))).toBe(
      false,
    );
    expect(isPassphraseAcceptable("a".repeat(MIN_PASSPHRASE_LENGTH))).toBe(
      true,
    );
    expect(() => assertPassphraseAcceptable("short")).toThrow(
      WalletPassphraseError,
    );
  });
});
