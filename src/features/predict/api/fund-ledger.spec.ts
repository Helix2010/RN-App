import { fromDecimal } from "../../../core/money/money";
import type { PredictServiceConfig } from "../../../core/config/bootstrap.schema";
import { memoryStorage } from "../../../core/gateways/types";
import type { FundRecord } from "../model/fund-record";
import { FundLedger } from "./fund-ledger";

const service = {
  domain: "predict.example.test",
  scopeId: "100000001",
  chain: "op-sepolia",
} as PredictServiceConfig;

const record = (id: string, patch: Partial<FundRecord> = {}): FundRecord => ({
  id,
  kind: "deposit",
  status: "pending",
  amount: fromDecimal("1", 6, "USDC"),
  createdAt: "2026-09-05T00:00:00.000Z",
  updatedAt: "2026-09-05T00:00:00.000Z",
  source: "local",
  ...patch,
});

describe("FundLedger", () => {
  it("keeps records per platform and address, newest first, and patches by id or hash", async () => {
    const ledger = new FundLedger(memoryStorage(), () => 1_000);
    await ledger.upsert(service, "0xAbC", record("deposit:1"));
    await ledger.upsert(service, "0xAbC", record("deposit:2", { hash: "0xH" }));
    await ledger.upsert(service, "0xother", record("deposit:9"));
    expect(
      (await ledger.list(service, "0xabc")).map((item) => item.id),
    ).toEqual(["deposit:2", "deposit:1"]);
    await ledger.patch(service, "0xabc", "deposit:1", { status: "failed" });
    await ledger.patchByHash(service, "0xabc", "0xh", { status: "confirmed" });
    const items = await ledger.list(service, "0xabc");
    expect(items.find((item) => item.id === "deposit:1")?.status).toBe(
      "failed",
    );
    expect(items.find((item) => item.id === "deposit:2")?.status).toBe(
      "confirmed",
    );
    expect(items[0]?.updatedAt).toBe(new Date(1_000).toISOString());
  });

  it("starts over when the stored ledger is not valid JSON", async () => {
    const storage = memoryStorage();
    await storage.setItem(
      "foundation.predict.fund-records.v1.predict.example.test.100000001.0xabc",
      "{oops",
    );
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const ledger = new FundLedger(storage);
    expect(await ledger.list(service, "0xabc")).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
