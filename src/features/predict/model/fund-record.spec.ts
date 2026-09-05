import { fromDecimal } from "../../../core/money/money";
import {
  FUND_RECORD_STALE_MS,
  isFundRecordOpen,
  mergeFundRecords,
  reconcileLocalRecord,
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

describe("reconcileLocalRecord", () => {
  const now = Date.parse("2026-09-05T12:00:00.000Z");
  it("confirms or fails a pending deposit by its receipt and leaves it pending otherwise", () => {
    const pending = record({ hash: "0xh", status: "pending" });
    expect(reconcileLocalRecord(pending, "success", now)).toEqual({
      status: "confirmed",
    });
    expect(reconcileLocalRecord(pending, "reverted", now)).toEqual({
      status: "failed",
      failure: "tx.reverted",
    });
    expect(reconcileLocalRecord(pending, "pending", now)).toBeNull();
  });

  it("marks a hash-less pending record as interrupted only after the stale window", () => {
    const fresh = record({
      status: "pending",
      createdAt: new Date(now - 60_000).toISOString(),
    });
    expect(reconcileLocalRecord(fresh, undefined, now)).toBeNull();
    const stale = record({
      status: "pending",
      createdAt: new Date(now - FUND_RECORD_STALE_MS - 1).toISOString(),
    });
    expect(reconcileLocalRecord(stale, undefined, now)).toEqual({
      status: "failed",
      failure: "records.failure.interrupted",
    });
  });

  it("turns a waiting withdrawal claimable once its time has come, and never touches platform records", () => {
    const waiting = record({
      kind: "withdraw",
      status: "waiting",
      requestId: "7",
      claimableAt: new Date(now - 1).toISOString(),
    });
    expect(reconcileLocalRecord(waiting, undefined, now)).toEqual({
      status: "claimable",
    });
    expect(
      reconcileLocalRecord(
        { ...waiting, claimableAt: new Date(now + 1).toISOString() },
        undefined,
        now,
      ),
    ).toBeNull();
    expect(
      reconcileLocalRecord({ ...waiting, source: "platform" }, undefined, now),
    ).toBeNull();
  });
});
