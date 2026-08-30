import type {
  Chain,
  ChainId,
  Page,
  TokenRef,
  Tx,
} from "../../../core/gateways/types";
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

/**
 * DEX 领域网关：一期 Mock，后续接自有 DEX 服务。字段保持聚合器中立。
 */
export interface DexGateway {
  listChains(): Promise<Chain[]>;
  listTokens(query: TokenQuery): Promise<Page<TokenSummary>>;
  searchTokens(text: string, chain?: ChainId): Promise<TokenSummary[]>;
  getToken(chain: ChainId, address: string): Promise<TokenDetail>;
  getCandles(
    chain: ChainId,
    address: string,
    interval: CandleInterval,
  ): Promise<Candle[]>;
  listTrades(chain: ChainId, address: string): Promise<DexTrade[]>;

  quote(request: QuoteRequest): Promise<Quote>;
  /** 是否需要先授权 spender */
  needsApproval(
    address: string,
    token: TokenRef,
    spender: string,
  ): Promise<boolean>;
  approve(
    address: string,
    token: TokenRef,
    spender: string,
    unlimited: boolean,
  ): Promise<Tx>;
  swap(address: string, quoteId: string): Promise<SwapRecord>;
  getSwap(id: string): Promise<SwapRecord | null>;
  listSwaps(
    address: string,
    filter?: { status?: "pending" | "confirmed" | "failed"; chain?: ChainId },
  ): Promise<SwapRecord[]>;
  listApprovals(address: string, chain?: ChainId): Promise<Approval[]>;
  revoke(address: string, approvalId: string): Promise<Tx>;
}
