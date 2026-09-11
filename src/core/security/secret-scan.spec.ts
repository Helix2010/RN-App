import {
  REDACTED,
  findSecrets,
  redactSecrets,
  registerSecretCanary,
  resetSecretCanaries,
} from "./secret-scan";

const PHRASE =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";
const PAIRING =
  "wc:7f6e5d4c3b2a1908@2?relay-protocol=irn&symKey=8fcb33017a0dc1058298c923c436d19dfa68ae93968e0b423248542e3afb9fc3";

describe("findSecrets", () => {
  afterEach(() => resetSecretCanaries());

  it("catches a recovery phrase that rode in on an error message", () => {
    // 这是真实的形状：没有人写过 console.log(phrase)，但异常 message 带上了它
    const message = `failed to import wallet: ${PHRASE}`;
    expect(findSecrets(message)).toContain("mnemonic");
  });

  it("catches a WalletConnect pairing URI", () => {
    expect(findSecrets(`pairing failed for ${PAIRING}`)).toContain(
      "pairing-uri",
    );
  });

  it("leaves ordinary diagnostics alone", () => {
    // 这个应用的诊断里交易哈希遍地都是；按"64 位十六进制"拦截会把它们全打码
    for (const text of [
      "error: TypeError: Cannot read property 'balance' of undefined",
      "tx 0x9858effd232b4033e47d90003d41ec34ecaeda949858effd232b4033e47d9000 reverted",
      "componentStack: at SendScreen at TransferForm at Page",
      "the quick brown fox jumps over the lazy dog again and again and again",
    ])
      expect(findSecrets(text)).toEqual([]);
  });

  it("does not fire on a few dictionary words that happen to be in the list", () => {
    // "legal winner thank year" 四个词都在 BIP-39 表里，但四个词不是助记词
    expect(findSecrets("legal winner thank year")).toEqual([]);
  });

  it("still fires when a dictionary word sits right next to the phrase", () => {
    // 回归：`phrase` 本身就在 BIP-39 词表里，连续长度变成 13。按"恰好 12/15/18/
    // 21/24 个词"判定会漏掉——而这正是最典型的泄漏形状
    expect(findSecrets(`phrase: ${PHRASE}`)).toContain("mnemonic");
    expect(findSecrets(`${PHRASE} legal`)).toContain("mnemonic");
  });

  it("needs a run long enough to be a phrase", () => {
    const words = PHRASE.split(" ");
    const repeat = (count: number) =>
      Array.from({ length: count }, (_, index) => words[index % 12]).join(" ");
    for (const length of [12, 15, 24, 25])
      expect(findSecrets(repeat(length))).toContain("mnemonic");
    for (const length of [1, 4, 11])
      expect(findSecrets(repeat(length))).toEqual([]);
  });

  it("finds a registered canary whose shape nothing could have matched", () => {
    // 私钥和交易哈希形状完全一样，判不出来；canary 是它的兜底
    const key =
      "0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318";
    expect(findSecrets(`signing with ${key}`)).toEqual([]);
    registerSecretCanary(key);
    expect(findSecrets(`signing with ${key}`)).toContain("canary");
  });

  it("refuses a canary too short to mean anything", () => {
    registerSecretCanary("0x");
    expect(findSecrets("0x1234 is a normal value")).toEqual([]);
  });
});

describe("redactSecrets", () => {
  afterEach(() => resetSecretCanaries());

  it("masks the phrase but keeps the rest of the diagnostic readable", () => {
    // 因为一行里混进了助记词就把整段扔掉，等于把排查路径也一起关掉
    const text = `error: import failed\nphrase: ${PHRASE}\ncomponentStack: at WalletImportScreen`;
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain("sausage");
    expect(redacted).toContain(REDACTED);
    expect(redacted).toContain("error: import failed");
    expect(redacted).toContain("at WalletImportScreen");
  });

  it("masks a pairing URI and a canary in the same text", () => {
    const key = "0x" + "ab".repeat(32);
    registerSecretCanary(key);
    const redacted = redactSecrets(`${PAIRING} then ${key}`);
    expect(redacted).not.toContain("symKey=");
    expect(redacted).not.toContain(key);
    expect(findSecrets(redacted)).toEqual([]);
  });

  it("masks two separate phrases without the first replacement shifting the second", () => {
    // 用非词表 token 隔开（"0x1" 不是单词），否则两段会连成同一串连续词
    const redacted = redactSecrets(`${PHRASE} 0x1 ${PHRASE}`);
    expect(redacted).not.toContain("sausage");
    expect(redacted).toContain("0x1");
    expect(
      redacted.match(new RegExp(REDACTED.replace(/[[\]]/g, "\\$&"), "g")),
    ).toHaveLength(2);
  });

  it("masks the whole run when ordinary words sit between two phrases", () => {
    // 中间那几个词也在词表里，整串就是一段连续词——一并盖掉。多盖几个普通单词，
    // 比漏掉助记词划算
    const redacted = redactSecrets(`${PHRASE} middle ${PHRASE}`);
    expect(redacted).not.toContain("sausage");
    expect(findSecrets(redacted)).toEqual([]);
  });

  it("is a no-op on text that carries no secret", () => {
    const text = "error: network request failed for /v1/mobile/bootstrap";
    expect(redactSecrets(text)).toBe(text);
  });
});
