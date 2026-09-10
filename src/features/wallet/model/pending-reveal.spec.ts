import {
  clearPendingPhrase,
  stashPendingPhrase,
  takePendingPhrase,
} from "./pending-reveal";

const PHRASE = "abandon ability able about above absent";

describe("pending reveal", () => {
  afterEach(() => clearPendingPhrase());

  it("hands the phrase over exactly once", () => {
    stashPendingPhrase(PHRASE);
    expect(takePendingPhrase()).toBe(PHRASE);
    // 第二次拿不到：备份页重挂载、返回再进都不该重新看到助记词
    expect(takePendingPhrase()).toBeNull();
  });

  it("has nothing to hand over before a wallet is created", () => {
    expect(takePendingPhrase()).toBeNull();
  });

  it("forgets the phrase when the flow is abandoned", () => {
    stashPendingPhrase(PHRASE);
    clearPendingPhrase();
    expect(takePendingPhrase()).toBeNull();
  });

  it("keeps only the newest phrase", () => {
    stashPendingPhrase(PHRASE);
    stashPendingPhrase("second phrase");
    expect(takePendingPhrase()).toBe("second phrase");
  });
});
