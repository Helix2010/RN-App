import { money } from "../../../core/money/money";
import {
  DISPUTE_EVIDENCE_MIN,
  PredictInsufficientBondError,
  normalizeDisputeInput,
  validateDisputeInput,
} from "./dispute";

const okEvidence = "证据".repeat(DISPUTE_EVIDENCE_MIN);

describe("validateDisputeInput", () => {
  it("counts code points and enforces the platform's 150–1000 range", () => {
    expect(validateDisputeInput({ evidence: "短", links: [] })).toMatchObject({
      evidenceChars: 1,
      evidenceError: "tooShort",
      ok: false,
    });
    expect(
      validateDisputeInput({ evidence: `  ${okEvidence}  `, links: [] }),
    ).toMatchObject({ evidenceChars: 300, evidenceError: undefined, ok: true });
    expect(
      validateDisputeInput({ evidence: "x".repeat(1001), links: [] }),
    ).toMatchObject({ evidenceError: "tooLong", ok: false });
    // emoji 按码点算一个字符
    expect(
      validateDisputeInput({ evidence: "😀".repeat(150), links: [] }),
    ).toMatchObject({ evidenceChars: 150, ok: true });
  });

  it("requires https links, at most five, ignoring blank rows", () => {
    const result = validateDisputeInput({
      evidence: okEvidence,
      links: [
        "https://a.example",
        "",
        "http://b.example",
        " https://c.example ",
      ],
    });
    expect(result.invalidLinks).toEqual([1]);
    expect(result.ok).toBe(false);
    expect(
      validateDisputeInput({
        evidence: okEvidence,
        links: Array.from({ length: 6 }, (_, i) => `https://x.example/${i}`),
      }),
    ).toMatchObject({ tooManyLinks: true, ok: false });
    expect(
      validateDisputeInput({
        evidence: okEvidence,
        links: [`https://${"a".repeat(500)}`],
      }).invalidLinks,
    ).toEqual([0]);
  });

  it("normalizes what gets submitted", () => {
    expect(
      normalizeDisputeInput({
        evidence: `  ${okEvidence} `,
        links: [" https://a.example ", "", "https://b.example"],
      }),
    ).toEqual({
      evidence: okEvidence,
      links: ["https://a.example", "https://b.example"],
    });
  });
});

describe("PredictInsufficientBondError", () => {
  it("exposes the shortfall for the wrap button", () => {
    const error = new PredictInsufficientBondError(
      money("5000000", 6, "USDW"),
      money("1000000", 6, "USDW"),
    );
    expect(error.shortfall).toEqual({
      raw: "4000000",
      decimals: 6,
      symbol: "USDW",
    });
  });
});
