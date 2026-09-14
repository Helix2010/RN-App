import {
  LOG_CAPACITY,
  MAX_FIELDS,
  MAX_FIELD_LENGTH,
  MAX_MESSAGE_LENGTH,
  clearLogs,
  logEvent,
  resetSecretLeakCount,
  secretLeakCount,
  snapshotLogs,
  tailLogs,
  toNdjson,
} from "./log-buffer";
import { REDACTED } from "../security/secret-scan";

const PHRASE =
  "legal winner thank year wave sausage worth useful legal winner thank yellow";

beforeEach(() => {
  clearLogs();
  resetSecretLeakCount();
});

describe("log buffer", () => {
  it("keeps the newest entries once it is full and drops the oldest", () => {
    for (let index = 0; index < LOG_CAPACITY + 10; index += 1)
      logEvent("info", "nav", `entry ${index}`);
    const entries = snapshotLogs();
    expect(entries).toHaveLength(LOG_CAPACITY);
    expect(entries[0]?.message).toBe("entry 10");
    expect(entries[entries.length - 1]?.message).toBe(
      `entry ${LOG_CAPACITY + 9}`,
    );
  });

  it("returns entries oldest first", () => {
    logEvent("info", "nav", "first");
    logEvent("info", "nav", "second");
    expect(snapshotLogs().map((entry) => entry.message)).toEqual([
      "first",
      "second",
    ]);
  });

  it("truncates an over-long message", () => {
    logEvent("warn", "net", "x".repeat(MAX_MESSAGE_LENGTH + 50));
    expect(snapshotLogs()[0]?.message).toHaveLength(MAX_MESSAGE_LENGTH);
  });

  it("truncates an over-long field value and caps the field count", () => {
    const fields: Record<string, string> = { long: "y".repeat(200) };
    for (let index = 0; index < MAX_FIELDS + 5; index += 1)
      fields[`k${index}`] = "v";
    logEvent("info", "net", "request", fields);
    const stored = snapshotLogs()[0]?.fields ?? {};
    expect(Object.keys(stored)).toHaveLength(MAX_FIELDS);
    expect(stored.long).toHaveLength(MAX_FIELD_LENGTH);
  });
});

describe("secret scrubbing at the diagnostics exit", () => {
  let consoleError: jest.SpyInstance;
  beforeEach(() => {
    consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => consoleError.mockRestore());

  it("redacts a recovery phrase that rode in on an error message", () => {
    // 这是真实的形状：没人写过 logEvent(phrase)，但异常 message 带上了它
    logEvent("error", "wallet", `import failed: ${PHRASE}`);
    const message = snapshotLogs()[0]?.message ?? "";
    expect(message).toContain(REDACTED);
    expect(message).not.toContain("sausage");
  });

  it("redacts a recovery phrase hiding in a field value", () => {
    logEvent("error", "wallet", "import failed", { input: PHRASE });
    expect(snapshotLogs()[0]?.fields?.input).toContain(REDACTED);
  });

  it("counts a hit so tests can assert it never happens", () => {
    // 命中即缺陷：出口扫描是最后一道网，不是防线（设计 §3.5）
    expect(secretLeakCount()).toBe(0);
    logEvent("error", "wallet", `import failed: ${PHRASE}`);
    expect(secretLeakCount()).toBe(1);
    // 开发构建下要大声报出来，而不是悄悄遮蔽了事
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("a structural guard is missing"),
    );
    // 报警本身不能把秘密再打一遍
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("sausage");
  });

  it("leaves ordinary diagnostics alone", () => {
    const hash = `0x${"a1b2c3d4".repeat(8)}`;
    logEvent("info", "wallet", "transfer submitted", { hash });
    expect(secretLeakCount()).toBe(0);
    expect(consoleError).not.toHaveBeenCalled();
    expect(snapshotLogs()[0]?.fields?.hash).toBe(hash);
  });
});

describe("upload format", () => {
  it("serialises one entry per line", () => {
    logEvent("info", "ota", "checking", { stage: "checking" });
    logEvent("warn", "ota", "check failed");
    const lines = toNdjson(snapshotLogs()).split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      level: "info",
      tag: "ota",
      message: "checking",
      fields: { stage: "checking" },
    });
    // 没有 fields 的条目不应该带一个 undefined 键进 JSON
    expect(lines[1]).not.toContain("fields");
  });

  it("tails the newest entries for a crash snapshot", () => {
    for (let index = 0; index < 10; index += 1)
      logEvent("info", "nav", `entry ${index}`);
    expect(tailLogs(3).map((entry) => entry.message)).toEqual([
      "entry 7",
      "entry 8",
      "entry 9",
    ]);
    expect(tailLogs(50)).toHaveLength(10);
  });
});
