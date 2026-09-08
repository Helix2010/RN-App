import { phaseLabel } from "./settlement-screen";

const t = (key: string) => `#${key}`;

describe("settlement phase copy", () => {
  it("maps every platform phase (gamma phase.go) to copy and shows unknown phases verbatim", () => {
    for (const phase of [
      "trading",
      "awaiting_proposal",
      "proposal_pending",
      "liveness_period",
      "awaiting_settlement",
      "awaiting_arbitration",
      "arbitration_pending",
      "settlement_pending",
      "cancellation_pending",
      "escalation_pending",
      "manual_needed",
      "settled",
      "canceled",
    ])
      expect(phaseLabel(phase, t)).toBe(`#predict.settlement.phase.${phase}`);
    expect(phaseLabel("Manual Needed", t)).toBe(
      "#predict.settlement.phase.manual_needed",
    );
    expect(phaseLabel("arbitrated", t)).toBe("arbitrated");
  });
});
