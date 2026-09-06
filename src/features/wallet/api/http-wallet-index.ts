import { z } from "zod";
import {
  CHAINS,
  NATIVE_TOKEN_ADDRESS,
  type ChainId,
} from "../../../core/gateways/types";
import { money } from "../../../core/money/money";
import { apiClient } from "../../../core/network/api-client";
import type { Session } from "../../session/model/session";
import type { TransferIndex, WalletTransfer } from "../model/wallet";

const INDEX_STATES = [
  "idle",
  "scanning",
  "catching_up",
  "stalled",
  "paused",
  "unconfigured",
] as const;

const tokenSchema = z.object({
  address: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.number().int(),
  displayDecimals: z.number().int(),
  logoColor: z.string(),
});

const itemSchema = z.object({
  chain: z.string(),
  direction: z.enum(["in", "out"]),
  asset: z.enum(["native", "erc20"]),
  contractAddress: z.string(),
  amountRaw: z.string(),
  counterparty: z.string(),
  txHash: z.string(),
  logIndex: z.number().int(),
  blockNumber: z.number().int(),
  blockTime: z.string(),
  attribution: z.enum(["tx", "unattributed"]),
  token: tokenSchema.nullable(),
});

const indexSchema = z.object({
  state: z.enum(INDEX_STATES),
  block: z.number().int().optional(),
  headBlock: z.number().int().optional(),
  time: z.string().optional(),
  lagSeconds: z.number().int().optional(),
});

const pageSchema = z.object({
  items: z.array(itemSchema),
  nextCursor: z.string().nullable(),
  index: z.record(z.string(), indexSchema),
});

type IndexedRow = z.infer<typeof itemSchema>;

/** 记录页展示用，最多翻这么多页；更早的去区块浏览器看 */
const MAX_PAGES = 5;
const PAGE_SIZE = 200;

export type WalletIndexResult = {
  items: WalletTransfer[];
  index: Partial<Record<ChainId, TransferIndex>>;
  /** 服务端给了但本构建无法显示的行数：代币不在目录（token=null）或链不在本构建 */
  hidden: number;
};

/** 平台收款索引；网关据它合并本机账本。测试用内存实现替换。 */
export type WalletIndexPort = {
  list: (address: string) => Promise<WalletIndexResult>;
};

/**
 * 平台扫链索引（RN-Server `GET /v1/mobile/wallet/transfers`）：链上收款与转出记录的
 * 唯一正式来源（设计 wallet-receive-index-2026-09-06 §4.11 / §4.13）。
 *
 * 服务端按**会话地址**返回记录，所以这里只认当前会话的地址——问别的地址会拿到
 * 错的数据，直接抛错而不是静默返回空。
 */
export class HttpWalletIndex implements WalletIndexPort {
  constructor(
    private readonly deps: {
      session: {
        get(): Promise<Session | null>;
        authorization(): Promise<Record<string, string>>;
      };
    },
  ) {}

  async list(address: string): Promise<WalletIndexResult> {
    const session = await this.deps.session.get();
    if (!session || session.address.toLowerCase() !== address.toLowerCase())
      throw new Error(
        `wallet index requires a signed-in session for ${address}`,
      );
    const headers = await this.deps.session.authorization();
    const items: WalletTransfer[] = [];
    let index: WalletIndexResult["index"] = {};
    let hidden = 0;
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      // 不用 URLSearchParams：React Native 的实现没有 set()
      const query: string =
        `limit=${PAGE_SIZE}` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
      const response: z.infer<typeof pageSchema> = await apiClient.get(
        `/v1/mobile/wallet/transfers?${query}`,
        pageSchema,
        { headers },
      );
      if (page === 0) index = indexOf(response.index);
      for (const row of response.items) {
        const mapped = transferOf(row);
        if (mapped) items.push(mapped);
        else hidden += 1;
      }
      cursor = response.nextCursor;
      if (!cursor) break;
    }
    return { items, index, hidden };
  }
}

function isChainId(value: string): value is ChainId {
  return Object.prototype.hasOwnProperty.call(CHAINS, value);
}

function indexOf(
  raw: Record<string, z.infer<typeof indexSchema>>,
): WalletIndexResult["index"] {
  const index: WalletIndexResult["index"] = {};
  for (const [chain, state] of Object.entries(raw))
    if (isChainId(chain)) index[chain] = state;
  return index;
}

/**
 * 服务端行 → 钱包记录。代币不在目录（token=null）或链不在本构建时返回 null，
 * 调用方计数并在界面说明，而不是编一个符号或精度把金额显示错。
 */
export function transferOf(row: IndexedRow): WalletTransfer | null {
  if (!isChainId(row.chain) || !row.token) return null;
  const token = row.token;
  return {
    // 同一笔交易可能既有 in 又有 out（合约内部转账），id 必须带方向与序号
    id: `${row.chain}:${row.txHash || `gap-${row.blockNumber}`}:${row.direction}:${row.logIndex}`,
    status: "confirmed",
    hash: row.txHash || undefined,
    updatedAt: row.blockTime,
    kind: row.direction === "in" ? "receive" : "send",
    token: {
      chain: row.chain,
      address:
        token.address === "native" ? NATIVE_TOKEN_ADDRESS : token.address,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      displayDecimals: token.displayDecimals,
      logoColor: token.logoColor,
      // verified 只能由客户端白名单授予（见 trustedTokens），服务端说了不算
      verified: false,
    },
    amount: money(row.amountRaw, token.decimals, token.symbol),
    counterparty: row.counterparty,
    attribution: row.attribution,
    blockTime: row.blockTime,
  };
}
