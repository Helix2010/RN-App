import type { Money } from "../../../core/money/money";
import type { DepositStep } from "../api/account-gateway";

export type FundRecordKind = "deposit" | "withdraw" | "claim";

/**
 * 资金记录状态：
 * - pending：已发起，链上还没确认（转入）/ 还没拿到回执（取回发起）；
 * - confirmed / failed：转入与领取的终态；
 * - waiting / claimable / claimed：取回的三个阶段（解包等待期 → 可领取 → 已领回钱包）。
 */
export type FundRecordStatus =
  "pending" | "confirmed" | "failed" | "waiting" | "claimable" | "claimed";

export type FundRecord = {
  /** 转入：`deposit:<发起时刻>`；取回：`withdraw:<requestId>`；领取：交易哈希 */
  id: string;
  kind: FundRecordKind;
  status: FundRecordStatus;
  /** 转入 = 存入的币与数量；取回 = 解包的 USDW；领取 = 回到钱包的 USDC */
  amount: Money;
  hash?: string;
  /** 取回 / 领取关联的解包请求 */
  requestId?: string;
  claimableAt?: string;
  /** 转入进行到哪一步（授权 / 包装 / 转入） */
  step?: DepositStep;
  /** 失败原因（原文，来自链或平台） */
  failure?: string;
  createdAt: string;
  updatedAt: string;
  /** local = 本机发起时记的；platform = 平台子图索引到的 */
  source: "local" | "platform";
};

export const FUND_RECORD_OPEN_STATUSES: FundRecordStatus[] = [
  "pending",
  "waiting",
  "claimable",
];

export function isFundRecordOpen(record: FundRecord): boolean {
  return FUND_RECORD_OPEN_STATUSES.includes(record.status);
}

/** 平台索引到的记录以平台为准；本机记录只补平台还没追上的那几笔。按时间倒序。 */
export function mergeFundRecords(
  local: FundRecord[],
  platform: FundRecord[],
): FundRecord[] {
  const byRequest = new Set(
    platform.flatMap((item) => (item.requestId ? [item.requestId] : [])),
  );
  const kept = local.filter(
    (item) =>
      item.kind !== "withdraw" ||
      !item.requestId ||
      !byRequest.has(item.requestId),
  );
  return [...platform, ...kept].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
}
