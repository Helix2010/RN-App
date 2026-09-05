import type { ChainId, TokenRef } from "../../../core/gateways/types";
import type { Money } from "../../../core/money/money";
import type {
  BalanceSnapshot,
  ChainBalanceFailure,
  TokenBalance,
} from "../../wallet/model/wallet";

/** 资产列表里的一行：链余额还没到时只有目录信息（`loading`），到了就是真实余额。 */
export type AssetRow = {
  token: TokenRef;
  amount: Money | null;
  usdValue: number | null;
  change24hPct: number | null;
  loading: boolean;
};

export type PredictSummary =
  | {
      status: "enabled";
      chain: ChainId;
      usd: number;
      available: Money;
      lockedInOrders: Money;
      safeBalance: Money;
    }
  | { status: "not-enabled" }
  /** 模块关闭 / 租户没配平台关联：预测账户不出现 */
  | null;

export type ChainResult =
  | { status: "loading" }
  | { status: "ready"; snapshot: BalanceSnapshot }
  | { status: "error"; error: unknown };

export type AssetsOverview = {
  totalUsd: number;
  change24hUsd: number;
  change24hPct: number;
  wallet: { usd: number; chains: number; address: string };
  /** undefined = 还在查 */
  predict: PredictSummary | undefined;
  rows: AssetRow[];
  /** 这次没拿到余额的链：总额与列表都不含它们，界面要单独说明 */
  unavailable: ChainBalanceFailure[];
  /** 查询本身抛错的链（不是网关报的"不可用"，是意料之外的错误） */
  failed: { chain: ChainId; error: unknown }[];
  /** 总额是部分合计：有链没到 / 不可用，或有持仓没有估值 */
  partial: boolean;
  /** 任一链或预测账户还没返回 */
  loading: boolean;
};

/**
 * 把"每条链各自的余额查询 + 预测账户"拼成一份总览。逐链独立：一条链慢或坏了，
 * 其它链的行与合计照常；还没返回的链先按下发目录列出币种，金额留白。
 */
export function composeOverview(input: {
  address: string;
  chains: ChainId[];
  catalogue: (chain: ChainId) => TokenRef[];
  results: (chain: ChainId) => ChainResult;
  predict: PredictSummary | undefined;
}): AssetsOverview {
  const rows: AssetRow[] = [];
  const unavailable: ChainBalanceFailure[] = [];
  const failed: { chain: ChainId; error: unknown }[] = [];
  let loadingChains = 0;
  let readyChains = 0;
  for (const chain of input.chains) {
    const result = input.results(chain);
    if (result.status === "ready") {
      readyChains += 1;
      // 网关按链过滤过；这里再按链筛一遍，替身返回整批时也不会把别的链算进来
      for (const item of result.snapshot.items)
        if (item.token.chain === chain) rows.push(loadedRow(item));
      for (const failure of result.snapshot.unavailable)
        if (failure.chain === chain) unavailable.push(failure);
      continue;
    }
    if (result.status === "error") failed.push({ chain, error: result.error });
    else loadingChains += 1;
    for (const token of input.catalogue(chain))
      rows.push({
        token,
        amount: null,
        usdValue: null,
        change24hPct: null,
        loading: result.status === "loading",
      });
  }
  const priced = rows.filter(
    (row): row is AssetRow & { usdValue: number; change24hPct: number } =>
      !row.loading && row.usdValue !== null && row.change24hPct !== null,
  );
  const walletUsd = priced.reduce((sum, row) => sum + row.usdValue, 0);
  const walletChange = priced.reduce(
    (sum, row) => sum + (row.usdValue * row.change24hPct) / 100,
    0,
  );
  const predictUsd =
    input.predict && input.predict.status === "enabled" ? input.predict.usd : 0;
  const totalUsd = walletUsd + predictUsd;
  const loading = loadingChains > 0 || input.predict === undefined;
  const loadedRows = rows.filter((row) => !row.loading);
  return {
    totalUsd,
    change24hUsd: walletChange,
    change24hPct:
      totalUsd > 0 ? (walletChange / (totalUsd - walletChange)) * 100 : 0,
    // 链数 = 启用的链里这次拿到余额的
    wallet: { usd: walletUsd, chains: readyChains, address: input.address },
    predict: input.predict,
    rows,
    unavailable,
    failed,
    partial:
      loading ||
      unavailable.length > 0 ||
      failed.length > 0 ||
      priced.length < loadedRows.length,
    loading,
  };
}

function loadedRow(item: TokenBalance): AssetRow {
  return {
    token: item.token,
    amount: item.amount,
    usdValue: item.usdValue,
    change24hPct: item.change24hPct,
    loading: false,
  };
}
