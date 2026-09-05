import { fromDecimal } from "../../../core/money/money";
import {
  isFundRecordOpen,
  mergeFundRecords,
  type FundRecord,
} from "./fund-record";

const record = (patch: Partial<FundRecord>): FundRecord => ({
  id: "deposit:1",
  kind: "deposit",
  status: "pending",
  amount: fromDecimal("10", 6, "USDC"),
  createdAt: "2026-09-05T00:00:00.000Z",
  updatedAt: "2026-09-05T00:00:00.000Z",
  source: "local",
  ...patch,
});

describe("fund records", () => {
  it("lets the platform's copy of a withdrawal replace the local one and sorts newest first", () => {
    const merged = mergeFundRecords(
      [
        record({
          id: "withdraw:7",
          kind: "withdraw",
          status: "waiting",
          requestId: "7",
          createdAt: "2026-09-05T01:00:00.000Z",
        }),
        record({ id: "deposit:1", createdAt: "2026-09-05T02:00:00.000Z" }),
      ],
      [
        record({
          id: "withdraw:7",
          kind: "withdraw",
          status: "claimed",
          requestId: "7",
          source: "platform",
          createdAt: "2026-09-05T01:00:00.000Z",
        }),
      ],
    );
    expect(merged.map((item) => [item.id, item.status, item.source])).toEqual([
      ["deposit:1", "pending", "local"],
      ["withdraw:7", "claimed", "platform"],
    ]);
  });

  it("treats pending, waiting and claimable as open", () => {
    expect(isFundRecordOpen(record({ status: "waiting" }))).toBe(true);
    expect(isFundRecordOpen(record({ status: "claimable" }))).toBe(true);
    expect(isFundRecordOpen(record({ status: "claimed" }))).toBe(false);
    expect(isFundRecordOpen(record({ status: "failed" }))).toBe(false);
  });
});
