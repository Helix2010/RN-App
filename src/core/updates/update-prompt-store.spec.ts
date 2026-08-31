import { shouldPromptUpdate } from "./update-prompt-store";

const now = Date.parse("2026-08-31T12:00:00Z");
const base = {
  decision: "optional" as const,
  latestVersion: "1.5.0",
  lastPromptedVersion: null,
  lastPromptedAt: null,
  nowMs: now,
};

describe("shouldPromptUpdate", () => {
  it("never prompts when there is no update", () => {
    expect(shouldPromptUpdate({ ...base, decision: "none" })).toBe(false);
  });

  it("always prompts for a required update, even within the throttle window", () => {
    expect(
      shouldPromptUpdate({
        ...base,
        decision: "required",
        lastPromptedVersion: "1.5.0",
        lastPromptedAt: new Date(now - 60_000).toISOString(),
      }),
    ).toBe(true);
  });

  it("prompts the first time a version is seen", () => {
    expect(shouldPromptUpdate(base)).toBe(true);
    expect(
      shouldPromptUpdate({
        ...base,
        lastPromptedVersion: "1.4.9",
        lastPromptedAt: new Date(now).toISOString(),
      }),
    ).toBe(true);
  });

  it("stays quiet for the same version within 24h and prompts again after", () => {
    const promptedAt = (agoMs: number) => new Date(now - agoMs).toISOString();
    expect(
      shouldPromptUpdate({
        ...base,
        lastPromptedVersion: "1.5.0",
        lastPromptedAt: promptedAt(60 * 60_000),
      }),
    ).toBe(false);
    expect(
      shouldPromptUpdate({
        ...base,
        lastPromptedVersion: "1.5.0",
        lastPromptedAt: promptedAt(24 * 60 * 60_000),
      }),
    ).toBe(true);
  });

  it("prompts when the stored timestamp is missing or unparseable", () => {
    expect(shouldPromptUpdate({ ...base, lastPromptedVersion: "1.5.0" })).toBe(
      true,
    );
    expect(
      shouldPromptUpdate({
        ...base,
        lastPromptedVersion: "1.5.0",
        lastPromptedAt: "not-a-date",
      }),
    ).toBe(true);
  });
});
