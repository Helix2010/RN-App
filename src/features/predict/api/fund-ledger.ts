import type { KeyValueStorage } from "../../../core/gateways/types";
import type { PredictServiceConfig } from "../../../core/config/bootstrap.schema";
import type { FundRecord } from "../model/fund-record";

const KEY_PREFIX = "foundation.predict.fund-records.v1";
/** 本机最多保留的记录数：超过就丢最旧的终态记录 */
const MAX_RECORDS = 200;

function keyFor(service: PredictServiceConfig, address: string): string {
  return `${KEY_PREFIX}.${service.domain}.${service.scopeId}.${address.toLowerCase()}`;
}

/**
 * 本机发起的资金操作账本（转入 / 取回发起 / 领取）。它是"这台设备做过什么"的正式来源：
 * 平台子图只索引解包请求，转入与领取在链上没有可查的用户维度记录。
 * 按 平台 + 租户 + 地址 分键，普通存储即可（不含凭证）。
 */
export class FundLedger {
  constructor(
    private readonly storage: KeyValueStorage,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async list(
    service: PredictServiceConfig,
    address: string,
  ): Promise<FundRecord[]> {
    const raw = await this.storage.getItem(keyFor(service, address));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as FundRecord[]) : [];
    } catch (error) {
      // 账本坏了不能装作没有记录：留痕，并从头开始记
      console.warn("[predict] fund ledger is corrupt, starting over", error);
      return [];
    }
  }

  async upsert(
    service: PredictServiceConfig,
    address: string,
    record: FundRecord,
  ): Promise<void> {
    const items = await this.list(service, address);
    const next = [
      record,
      ...items.filter((item) => item.id !== record.id),
    ].slice(0, MAX_RECORDS);
    await this.storage.setItem(keyFor(service, address), JSON.stringify(next));
  }

  async patch(
    service: PredictServiceConfig,
    address: string,
    id: string,
    patch: Partial<Omit<FundRecord, "id" | "kind" | "createdAt">>,
  ): Promise<FundRecord | null> {
    const items = await this.list(service, address);
    const current = items.find((item) => item.id === id);
    if (!current) return null;
    const next: FundRecord = {
      ...current,
      ...patch,
      updatedAt: new Date(this.now()).toISOString(),
    };
    await this.storage.setItem(
      keyFor(service, address),
      JSON.stringify(items.map((item) => (item.id === id ? next : item))),
    );
    return next;
  }

  /** 按交易哈希找记录（转入的确认 / 失败由 getTx 轮询回写） */
  async patchByHash(
    service: PredictServiceConfig,
    address: string,
    hash: string,
    patch: Partial<Omit<FundRecord, "id" | "kind" | "createdAt">>,
  ): Promise<void> {
    const items = await this.list(service, address);
    const match = items.find(
      (item) => item.hash?.toLowerCase() === hash.toLowerCase(),
    );
    if (match) await this.patch(service, address, match.id, patch);
  }
}
