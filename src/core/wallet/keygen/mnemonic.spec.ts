import {
  EVM_ACCOUNT_PATH,
  accountFromPrivateKey,
  deriveAccount,
  evmPath,
  generateMnemonic,
  isValidMnemonic,
  isValidPrivateKey,
  normalizeMnemonic,
  normalizePrivateKey,
} from "./mnemonic";

/** BIP-39 官方全零熵向量，以及它在 BIP-44 EVM 路径上的公开测试地址。 */
const ZERO_ENTROPY_PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const ZERO_ENTROPY_ADDRESS_0 = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const ZERO_ENTROPY_ADDRESS_1 = "0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0";

describe("mnemonic", () => {
  it("derives the published BIP-44 test vector addresses", () => {
    expect(deriveAccount(ZERO_ENTROPY_PHRASE, 0)).toMatchObject({
      address: ZERO_ENTROPY_ADDRESS_0,
      path: `${EVM_ACCOUNT_PATH}/0`,
    });
    expect(deriveAccount(ZERO_ENTROPY_PHRASE, 1).address).toBe(
      ZERO_ENTROPY_ADDRESS_1,
    );
  });

  it("generates valid 12-word phrases that differ every time", () => {
    const first = generateMnemonic();
    const second = generateMnemonic();
    expect(first.split(" ")).toHaveLength(12);
    expect(isValidMnemonic(first)).toBe(true);
    expect(first).not.toBe(second);
    expect(generateMnemonic(256).split(" ")).toHaveLength(24);
  });

  it("normalizes user-pasted phrases and rejects invalid ones", () => {
    expect(normalizeMnemonic("  Abandon\n ABANDON\tabandon  ")).toBe(
      "abandon abandon abandon",
    );
    expect(isValidMnemonic(`  ${ZERO_ENTROPY_PHRASE.toUpperCase()}  `)).toBe(
      true,
    );
    expect(isValidMnemonic("")).toBe(false);
    expect(isValidMnemonic("abandon abandon abandon")).toBe(false);
    // 词都在词表里但校验和错误
    expect(
      isValidMnemonic(ZERO_ENTROPY_PHRASE.replace(/about$/, "abandon")),
    ).toBe(false);
    expect(() => deriveAccount("not a mnemonic")).toThrow("invalid mnemonic");
  });

  it("accepts private keys with or without the 0x prefix", () => {
    const key = deriveAccount(ZERO_ENTROPY_PHRASE, 0).privateKey;
    expect(isValidPrivateKey(key)).toBe(true);
    expect(isValidPrivateKey(key.slice(2).toUpperCase())).toBe(true);
    expect(normalizePrivateKey(key.slice(2).toUpperCase())).toBe(key);
    expect(accountFromPrivateKey(key)).toMatchObject({
      address: ZERO_ENTROPY_ADDRESS_0,
      path: null,
    });
    expect(isValidPrivateKey("0x00")).toBe(false);
    expect(isValidPrivateKey(`0x${"0".repeat(64)}`)).toBe(false);
    expect(() => accountFromPrivateKey("0xnope")).toThrow(
      "invalid private key",
    );
  });

  it("rejects nonsensical derivation indexes", () => {
    expect(evmPath(3)).toBe(`${EVM_ACCOUNT_PATH}/3`);
    expect(() => evmPath(-1)).toThrow();
    expect(() => evmPath(1.5)).toThrow();
  });
});
