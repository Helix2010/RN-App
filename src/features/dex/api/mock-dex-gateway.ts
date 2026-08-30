import {
  CHAINS,
  memoryStorage,
  nextId,
  type Chain,
  type ChainId,
  type KeyValueStorage,
  type Page,
  type TokenRef,
  type Tx,
} from "../../../core/gateways/types";
import {
  isEmptyMode,
  mockNow,
  mockNowIso,
  mockRandom,
  simulate,
} from "../../../core/mock/mock-runtime";
import {
  fromDecimal,
  money,
  scaleBps,
  sub,
  toApproxNumber,
} from "../../../core/money/money";
import type { WalletGateway } from "../../wallet/api/gateway";
import {
  REFERENCE_PRICES_USD,
  TOKENS,
  tokenKey,
} from "../../wallet/fixtures/wallet";
import { DESCRIPTIONS, SECURITY, TOKEN_SUMMARIES } from "../fixtures/tokens";
import type {
  Approval,
  Candle,
  CandleInterval,
  DexTrade,
  Quote,
  QuoteRequest,
  SwapRecord,
  TokenDetail,
  TokenQuery,
  TokenSummary,
} from "../model/dex";
import type { DexGateway } from "./gateway";

type State = {
  swaps: SwapRecord[];
  approvals: Record<string, Approval[]>;
  quotes: Record<string, Quote>;
  txs: Tx[];
};

const KEY = "foundation.mock-state.dex.v1";
const QUOTE_TTL_MS = 12_000;
const ROUTERS: Record<
  ChainId,
  { name: string; address: string; wrapped: string }
> = {
  bsc: {
    name: "PancakeSwap V3",
    address: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    wrapped: "WBNB",
  },
  eth: {
    name: "Uniswap V3",
    address: "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    wrapped: "WETH",
  },
  base: {
    name: "Aerodrome",
    address: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
    wrapped: "WETH",
  },
};

function priceUsd(token: TokenRef): number {
  return REFERENCE_PRICES_USD[tokenKey(token)] ?? 0;
}

export class MockDexGateway implements DexGateway {
  private state: State | null = null;
  private loading: Promise<State> | null = null;
  /** 注入下一次兑换结果，演示失败态 */
  nextSwapOutcome: "ok" | "slippage" = "ok";

  constructor(
    private readonly storage: KeyValueStorage = memoryStorage(),
    private readonly wallet: WalletGateway,
  ) {}

  private async load(): Promise<State> {
    if (this.state) return this.state;
    if (!this.loading) {
      this.loading = (async () => {
        const raw = await this.storage.getItem(KEY);
        if (raw) {
          try {
            this.state = JSON.parse(raw) as State;
            return this.state;
          } catch {
            /* rebuild */
          }
        }
        this.state = { swaps: [], approvals: {}, quotes: {}, txs: [] };
        return this.state;
      })();
    }
    return this.loading;
  }

  private async save(): Promise<void> {
    if (this.state) await this.storage.setItem(KEY, JSON.stringify(this.state));
  }

  private ensureAccount(state: State, address: string): void {
    if (state.approvals[address]) return;
    const usdt = TOKENS["USDT.bsc"] as TokenRef;
    const usdc = TOKENS["USDC.eth"] as TokenRef;
    const aero = TOKENS.AERO as TokenRef;
    state.approvals[address] = [
      {
        id: nextId("apr"),
        chain: "bsc",
        token: usdt,
        spender: { name: "PancakeSwap Router", address: ROUTERS.bsc.address },
        allowance: null,
        approvedAt: "2026-08-12T09:00:00Z",
        lastUsedAt: "2026-08-30T04:10:00Z",
      },
      {
        id: nextId("apr"),
        chain: "eth",
        token: usdc,
        spender: {
          name: "Uniswap Permit2",
          address: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
        },
        allowance: null,
        approvedAt: "2026-07-03T11:00:00Z",
        lastUsedAt: "2026-07-03T11:02:00Z",
      },
      {
        id: nextId("apr"),
        chain: "base",
        token: aero,
        spender: { name: "Aerodrome Router", address: ROUTERS.base.address },
        allowance: fromDecimal("120", 18, "AERO"),
        approvedAt: "2026-08-28T15:00:00Z",
      },
    ];
    if (state.swaps.length === 0) {
      const bnb = TOKENS.BNB as TokenRef;
      const pepe = TOKENS.PEPE as TokenRef;
      const cake = TOKENS.CAKE as TokenRef;
      const eth = TOKENS["ETH.base"] as TokenRef;
      state.swaps = [
        {
          id: nextId("swp"),
          chain: "bsc",
          sellToken: usdt,
          buyToken: pepe,
          amountIn: fromDecimal("100", 18, "USDT"),
          amountOut: fromDecimal("8102110", 18, "PEPE"),
          status: "confirmed",
          txHash: "0x9a1b…c3d4",
          at: "2026-08-29T03:47:00Z",
          updatedAt: "2026-08-29T03:47:20Z",
        },
        {
          id: nextId("swp"),
          chain: "bsc",
          sellToken: bnb,
          buyToken: cake,
          amountIn: fromDecimal("0.2", 18, "BNB"),
          amountOut: fromDecimal("43.96", 18, "CAKE"),
          status: "confirmed",
          txHash: "0x5e6f…a1b2",
          at: "2026-08-29T10:02:00Z",
          updatedAt: "2026-08-29T10:02:15Z",
        },
        {
          id: nextId("swp"),
          chain: "base",
          sellToken: eth,
          buyToken: aero,
          amountIn: fromDecimal("0.12", 18, "ETH"),
          status: "failed",
          reasonKey: "dex.swap.failed.slippage",
          at: "2026-08-29T14:18:00Z",
          updatedAt: "2026-08-29T14:18:30Z",
        },
      ];
    }
  }

  private summaries(): TokenSummary[] {
    return TOKEN_SUMMARIES.map((summary) => {
      const jitter = 1 + (mockRandom() - 0.5) * 0.004;
      const price = Number(summary.priceUsd) * jitter;
      return {
        ...summary,
        priceUsd: price.toPrecision(6).replace(/\.?0+$/, ""),
      };
    });
  }

  async listChains(): Promise<Chain[]> {
    return Object.values(CHAINS);
  }

  async listTokens(query: TokenQuery): Promise<Page<TokenSummary>> {
    return simulate(() => {
      if (isEmptyMode()) return { items: [], nextCursor: null };
      let items = this.summaries();
      if (query.chain)
        items = items.filter((item) => item.token.chain === query.chain);
      if (query.minLiquidityUsd)
        items = items.filter(
          (item) => item.liquidityUsd >= (query.minLiquidityUsd ?? 0),
        );
      if (query.search) {
        const needle = query.search.toLowerCase();
        items = items.filter(
          (item) =>
            item.token.symbol.toLowerCase().includes(needle) ||
            item.token.name.toLowerCase().includes(needle) ||
            item.token.address.toLowerCase() === needle,
        );
      }
      if (query.sort === "gainers")
        items = [...items].sort((a, b) => b.change24hPct - a.change24hPct);
      else if (query.sort === "new")
        items = [...items]
          .filter((item) => item.isNew)
          .sort((a, b) => b.listedAt.localeCompare(a.listedAt));
      else items = [...items].sort((a, b) => b.volume24hUsd - a.volume24hUsd);
      const limit = query.limit ?? 20;
      const start = query.cursor ? Number(query.cursor) : 0;
      return {
        items: items.slice(start, start + limit),
        nextCursor: start + limit < items.length ? String(start + limit) : null,
      };
    });
  }

  async searchTokens(text: string, chain?: ChainId): Promise<TokenSummary[]> {
    const page = await this.listTokens({
      sort: "hot",
      search: text,
      chain,
      limit: 20,
    });
    return page.items;
  }

  async getToken(chain: ChainId, address: string): Promise<TokenDetail> {
    return simulate(() => {
      const summary = this.summaries().find(
        (item) =>
          item.token.chain === chain &&
          item.token.address.toLowerCase() === address.toLowerCase(),
      );
      if (!summary) throw new Error(`token not found ${chain}:${address}`);
      const key = tokenKey(summary.token);
      const price = Number(summary.priceUsd);
      return {
        ...summary,
        high24hUsd: (price * 1.055).toPrecision(6).replace(/\.?0+$/, ""),
        low24hUsd: (price * 0.883).toPrecision(6).replace(/\.?0+$/, ""),
        security: SECURITY[key] ?? {
          openSource: false,
          mintable: true,
          buyTaxBps: 0,
          sellTaxBps: 0,
          top10Pct: 60,
          honeypot: false,
          passed: 0,
          total: 4,
        },
        description: DESCRIPTIONS[key],
      };
    });
  }

  async getCandles(
    chain: ChainId,
    address: string,
    interval: CandleInterval,
  ): Promise<Candle[]> {
    return simulate(() => {
      const summary = TOKEN_SUMMARIES.find(
        (item) =>
          item.token.chain === chain &&
          item.token.address.toLowerCase() === address.toLowerCase(),
      );
      if (!summary) return [];
      const stepMs =
        interval === "15m"
          ? 900_000
          : interval === "1h"
            ? 3_600_000
            : interval === "4h"
              ? 14_400_000
              : interval === "1d"
                ? 86_400_000
                : 604_800_000;
      const count = 60;
      const end = Number(summary.priceUsd);
      let seed = address
        .split("")
        .reduce((acc, ch) => acc + ch.charCodeAt(0), 3);
      const closes: number[] = [end];
      for (let i = 1; i < count; i += 1) {
        seed = (seed * 9301 + 49297) % 233280;
        closes.push(
          (closes[i - 1] ?? end) * (1 + (seed / 233280 - 0.5) * 0.06),
        );
      }
      closes.reverse();
      const now = mockNow();
      return closes.map((close, index) => {
        const open = closes[index - 1] ?? close * 0.99;
        seed = (seed * 9301 + 49297) % 233280;
        const wick = Math.abs(close - open) * 0.6 + close * 0.004;
        return {
          t: new Date(now - (count - 1 - index) * stepMs).toISOString(),
          o: open,
          h: Math.max(open, close) + wick,
          l: Math.min(open, close) - wick,
          c: close,
          v: 20_000 + (seed / 233280) * 80_000,
        };
      });
    });
  }

  async listTrades(chain: ChainId, address: string): Promise<DexTrade[]> {
    return simulate(() => {
      const summary = TOKEN_SUMMARIES.find(
        (item) =>
          item.token.chain === chain &&
          item.token.address.toLowerCase() === address.toLowerCase(),
      );
      if (!summary) return [];
      const price = Number(summary.priceUsd);
      const now = mockNow();
      return Array.from({ length: 12 }, (_, index) => {
        const usd = 10 + mockRandom() * 800;
        const amount = fromDecimal(
          (usd / price).toFixed(Math.min(6, summary.token.decimals)),
          summary.token.decimals,
          summary.token.symbol,
        );
        return {
          id: nextId("trd"),
          at: new Date(
            now - index * (8_000 + mockRandom() * 40_000),
          ).toISOString(),
          side: mockRandom() < 0.58 ? "buy" : "sell",
          amount,
          usd: Math.round(usd * 10) / 10,
          txHash: `0x${Math.floor(mockRandom() * 1e15).toString(16)}`,
        } satisfies DexTrade;
      });
    });
  }

  async quote(request: QuoteRequest): Promise<Quote> {
    return simulate(async () => {
      const state = await this.load();
      const sellUsd = priceUsd(request.sellToken);
      const buyUsd = priceUsd(request.buyToken);
      if (sellUsd <= 0 || buyUsd <= 0) throw new Error("no liquidity");
      const amountInUsd = toApproxNumber(request.amountIn) * sellUsd;
      const liquidity =
        TOKEN_SUMMARIES.find(
          (item) => tokenKey(item.token) === tokenKey(request.buyToken),
        )?.liquidityUsd ?? 20_000_000;
      const priceImpactPct = Math.min(45, (amountInUsd / liquidity) * 100 * 2);
      const serviceFeeBps = 10;
      const outUsd =
        amountInUsd * (1 - priceImpactPct / 100) * (1 - serviceFeeBps / 10_000);
      const amountOut = fromDecimal(
        (outUsd / buyUsd).toFixed(Math.min(8, request.buyToken.decimals)),
        request.buyToken.decimals,
        request.buyToken.symbol,
      );
      const slippageAuto = request.slippageBps === undefined;
      const slippageBps =
        request.slippageBps ?? (priceImpactPct > 1 ? 100 : 50);
      const minReceived = sub(amountOut, scaleBps(amountOut, slippageBps));
      const router = ROUTERS[request.chain];
      const native = request.sellToken.address === "native";
      const route = native
        ? [request.sellToken.symbol, router.wrapped, request.buyToken.symbol]
        : [request.sellToken.symbol, request.buyToken.symbol];
      const nativeSymbol = CHAINS[request.chain].nativeSymbol;
      const nativePrice =
        request.chain === "bsc"
          ? (REFERENCE_PRICES_USD.BNB ?? 600)
          : (REFERENCE_PRICES_USD.ETH ?? 4500);
      const feeNative =
        request.chain === "bsc"
          ? 0.00012
          : request.chain === "base"
            ? 0.00002
            : 0.0009;
      const quote: Quote = {
        id: nextId("qt"),
        chain: request.chain,
        sellToken: request.sellToken,
        buyToken: request.buyToken,
        amountIn: request.amountIn,
        amountOut,
        minReceived,
        amountInUsd,
        amountOutUsd: outUsd,
        priceImpactPct: Math.round(priceImpactPct * 100) / 100,
        rate: (sellUsd / buyUsd).toPrecision(8).replace(/\.?0+$/, ""),
        route,
        routerName: router.name,
        networkFee: fromDecimal(feeNative.toString(), 18, nativeSymbol),
        networkFeeUsd: Math.round(feeNative * nativePrice * 100) / 100,
        serviceFeeBps,
        slippageBps,
        slippageAuto,
        expiresAt: new Date(mockNow() + QUOTE_TTL_MS).toISOString(),
        needsApproval:
          !native &&
          !(await this.hasApproval(state, request.sellToken, router.address)),
      };
      state.quotes[quote.id] = quote;
      await this.save();
      return quote;
    });
  }

  private async hasApproval(
    state: State,
    token: TokenRef,
    spender: string,
  ): Promise<boolean> {
    return Object.values(state.approvals).some((list) =>
      list.some(
        (item) =>
          tokenKey(item.token) === tokenKey(token) &&
          item.spender.address.toLowerCase() === spender.toLowerCase(),
      ),
    );
  }

  async needsApproval(
    address: string,
    token: TokenRef,
    spender: string,
  ): Promise<boolean> {
    const state = await this.load();
    this.ensureAccount(state, address);
    if (token.address === "native") return false;
    return !(state.approvals[address] ?? []).some(
      (item) =>
        tokenKey(item.token) === tokenKey(token) &&
        item.spender.address.toLowerCase() === spender.toLowerCase(),
    );
  }

  async approve(
    address: string,
    token: TokenRef,
    spender: string,
    unlimited: boolean,
  ): Promise<Tx> {
    return simulate(async () => {
      const state = await this.load();
      this.ensureAccount(state, address);
      const router = Object.values(ROUTERS).find(
        (item) => item.address.toLowerCase() === spender.toLowerCase(),
      );
      (state.approvals[address] as Approval[]).unshift({
        id: nextId("apr"),
        chain: token.chain,
        token,
        spender: { name: router?.name ?? "Router", address: spender },
        allowance: unlimited
          ? null
          : fromDecimal("1000000", token.decimals, token.symbol),
        approvedAt: mockNowIso(),
      });
      const tx = this.pushTx(state);
      await this.save();
      return tx;
    });
  }

  private pushTx(state: State): Tx {
    const tx: Tx = {
      id: nextId("dtx"),
      status: "submitted",
      updatedAt: mockNowIso(),
      hash: `0x${Math.floor(mockRandom() * 1e15)
        .toString(16)
        .padStart(14, "0")}${"2".repeat(50)}`,
    };
    state.txs.unshift(tx);
    setTimeout(() => void this.advanceTx(tx.id, "confirming"), 1_200);
    setTimeout(() => void this.advanceTx(tx.id, "confirmed"), 3_200);
    return tx;
  }

  private async advanceTx(id: string, status: Tx["status"]): Promise<void> {
    const state = await this.load();
    const tx = state.txs.find((item) => item.id === id);
    if (tx && tx.status !== "confirmed" && tx.status !== "failed") {
      tx.status = status;
      tx.updatedAt = mockNowIso();
      await this.save();
    }
  }

  async swap(address: string, quoteId: string): Promise<SwapRecord> {
    return simulate(async () => {
      const state = await this.load();
      this.ensureAccount(state, address);
      const quote = state.quotes[quoteId];
      if (!quote) throw new Error("quote not found");
      if (new Date(quote.expiresAt).getTime() < mockNow())
        throw new Error("quote expired");
      const record: SwapRecord = {
        id: nextId("swp"),
        chain: quote.chain,
        sellToken: quote.sellToken,
        buyToken: quote.buyToken,
        amountIn: quote.amountIn,
        status: "submitted",
        at: mockNowIso(),
        updatedAt: mockNowIso(),
        txHash: `0x${Math.floor(mockRandom() * 1e15)
          .toString(16)
          .padStart(14, "0")}${"3".repeat(50)}`,
      };
      // 扣减支付侧余额；失败时在后续步骤回滚
      await this.wallet.adjustBalance(
        address,
        quote.sellToken,
        money(
          (-BigInt(quote.amountIn.raw)).toString(),
          quote.amountIn.decimals,
          quote.amountIn.symbol,
        ),
      );
      state.swaps.unshift(record);
      const outcome = this.nextSwapOutcome;
      this.nextSwapOutcome = "ok";
      await this.save();
      setTimeout(
        () =>
          void this.advanceSwap(
            address,
            record.id,
            "confirming",
            quote,
            outcome,
          ),
        1_500,
      );
      setTimeout(
        () =>
          void this.advanceSwap(
            address,
            record.id,
            outcome === "ok" ? "confirmed" : "failed",
            quote,
            outcome,
          ),
        4_500,
      );
      return record;
    });
  }

  private async advanceSwap(
    address: string,
    id: string,
    status: SwapRecord["status"],
    quote: Quote,
    outcome: "ok" | "slippage",
  ): Promise<void> {
    const state = await this.load();
    const record = state.swaps.find((item) => item.id === id);
    if (!record || record.status === "confirmed" || record.status === "failed")
      return;
    record.status = status;
    record.updatedAt = mockNowIso();
    if (status === "confirmed") {
      const executed = sub(
        quote.amountOut,
        scaleBps(
          quote.amountOut,
          Math.floor(mockRandom() * Math.max(1, quote.slippageBps / 2)),
        ),
      );
      record.amountOut = executed;
      await this.wallet.adjustBalance(address, quote.buyToken, executed);
    }
    if (status === "failed") {
      record.reasonKey =
        outcome === "slippage"
          ? "dex.swap.failed.slippage"
          : "dex.swap.failed.unknown";
      await this.wallet.adjustBalance(address, quote.sellToken, quote.amountIn);
    }
    await this.save();
  }

  async getSwap(id: string): Promise<SwapRecord | null> {
    const state = await this.load();
    const swap = state.swaps.find((item) => item.id === id);
    return swap ? { ...swap } : null;
  }

  async listSwaps(
    address: string,
    filter?: { status?: "pending" | "confirmed" | "failed"; chain?: ChainId },
  ): Promise<SwapRecord[]> {
    return simulate(async () => {
      const state = await this.load();
      this.ensureAccount(state, address);
      if (isEmptyMode()) return [];
      return state.swaps.filter((item) => {
        if (filter?.chain && item.chain !== filter.chain) return false;
        if (filter?.status === "pending")
          return item.status !== "confirmed" && item.status !== "failed";
        if (filter?.status) return item.status === filter.status;
        return true;
      });
    });
  }

  async listApprovals(address: string, chain?: ChainId): Promise<Approval[]> {
    return simulate(async () => {
      const state = await this.load();
      this.ensureAccount(state, address);
      return (state.approvals[address] ?? []).filter(
        (item) => !chain || item.chain === chain,
      );
    });
  }

  async revoke(address: string, approvalId: string): Promise<Tx> {
    return simulate(async () => {
      const state = await this.load();
      state.approvals[address] = (state.approvals[address] ?? []).filter(
        (item) => item.id !== approvalId,
      );
      const tx = this.pushTx(state);
      await this.save();
      return tx;
    });
  }
}
