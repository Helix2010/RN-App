import type { OrderBook, OrderBookLevel, Outcome } from "./predict";

export type BookRow = {
  priceCents: number;
  shares: number;
  /** 从最优价累计到本档的美元额（份数 × 价格） */
  totalUsd: number;
  /** 深度条宽度（相对本侧最大累计额） */
  barPct: number;
};

export type BookView = {
  /** 由远及近：第一行离盘口最远，最后一行是卖一 */
  asks: BookRow[];
  /** 由近及远：第一行是买一 */
  bids: BookRow[];
  bestBid: number | null;
  bestAsk: number | null;
  spreadCents: number | null;
  lastCents: number | null;
};

const mirror = (cents: number) => Math.round((100 - cents) * 10) / 10;

/**
 * 把 YES 簿整理成盘口视图（网页版 `OutcomeOrderbook` 的推导）：
 * - No 侧 = Yes 簿的镜像：Yes 的卖单就是 No 的买单（价 100 − p）；
 * - 每侧只取离盘口最近的 `depth` 档，累计额从最优价往外累加；
 * - 卖盘反过来排（最远在上、卖一在下），和买盘拼成上红下绿的一列。
 */
export function deriveBookView(
  book: OrderBook,
  outcome: Outcome,
  depth = 5,
): BookView {
  const yesBids = [...book.bids].sort((a, b) => b.priceCents - a.priceCents);
  const yesAsks = [...book.asks].sort((a, b) => a.priceCents - b.priceCents);
  const flip = (levels: OrderBookLevel[]) =>
    levels.map((level) => ({ ...level, priceCents: mirror(level.priceCents) }));
  const bids =
    outcome === "yes"
      ? yesBids
      : flip(yesAsks).sort((a, b) => b.priceCents - a.priceCents);
  const asks =
    outcome === "yes"
      ? yesAsks
      : flip(yesBids).sort((a, b) => a.priceCents - b.priceCents);
  const cumulative = (levels: OrderBookLevel[]): BookRow[] => {
    let total = 0;
    const rows = levels.slice(0, depth).map((level) => {
      total += (level.shares * level.priceCents) / 100;
      return {
        priceCents: level.priceCents,
        shares: level.shares,
        totalUsd: total,
        barPct: 0,
      };
    });
    const max = Math.max(total, 1e-9);
    return rows.map((row) => ({
      ...row,
      barPct: Math.min(100, (row.totalUsd / max) * 100),
    }));
  };
  const bestBid = bids[0]?.priceCents ?? null;
  const bestAsk = asks[0]?.priceCents ?? null;
  const last =
    book.lastTradeCents === null
      ? null
      : outcome === "yes"
        ? book.lastTradeCents
        : mirror(book.lastTradeCents);
  return {
    asks: cumulative(asks).reverse(),
    bids: cumulative(bids),
    bestBid,
    bestAsk,
    spreadCents:
      bestBid !== null && bestAsk !== null
        ? Math.round((bestAsk - bestBid) * 10) / 10
        : null,
    lastCents: last,
  };
}
