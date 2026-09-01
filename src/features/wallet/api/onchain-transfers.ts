import { CHAINS, type ChainId, type Tx } from "../../../core/gateways/types";
import { money, type Money } from "../../../core/money/money";
import { ChainClient } from "../../../core/chain/chain-client";
import { createRpcClient } from "../../../core/chain/rpc-client";
import { TransferService } from "../../../core/chain/transfer-service";
import type { WalletSigner } from "../../../core/wallet/signer/types";
import {
  evmChainIdOf,
  rpcUrlsFor,
} from "../../../core/wallet/config/wallet-runtime-config";
import type {
  SendRequest,
  TransferQuote,
  WalletTransfer,
} from "../model/wallet";

/** 原生币的哨兵地址，和 TokenRef 的约定一致。 */
const NATIVE = "native";

/**
 * 真实链上的转出。
 *
 * **可用性就是开关**：一条链只有在服务端下发了 RPC 端点时才走真链，否则回落到
 * Mock 账本。不需要额外的 feature flag——"有没有端点"本身就是最直接的判据，
 * 也让灰度等于"给哪个租户配 RPC"。
 *
 * 每条链一套客户端，惰性创建：没人转那条链就不该建连接。下发的端点变了就丢弃重建。
 */
export class OnchainTransfers {
  private readonly services = new Map<
    ChainId,
    { endpoints: string; chain: ChainClient; transfer: TransferService }
  >();
  /**
   * txHash → 这笔转账的链与快照。
   *
   * 只在内存里：转账进度只在提交后的几分钟内有意义，冷启动后用户可以去区块浏览器
   * 查。完整的链上历史需要索引服务（`eth_getLogs` 有区块范围限制），不在这一层。
   */
  private readonly submitted = new Map<
    string,
    { chain: ChainId; from: string; transfer: WalletTransfer }
  >();

  constructor(
    private readonly deps: {
      /** 签名弹窗 / 外部钱包里显示的说明，已 i18n */
      reason: string;
      now?: () => number;
      /** 仅供测试替换：默认按下发的端点建真实客户端 */
      createChain?: (endpoints: string[]) => ChainClient;
    },
  ) {}

  available(chain: ChainId): boolean {
    return rpcUrlsFor(chain).length > 0;
  }

  async send(
    request: SendRequest,
    signer: WalletSigner,
  ): Promise<WalletTransfer> {
    const chain = request.token.chain;
    const { transfer } = this.serviceFor(chain);
    const submitted = await transfer.submit(this.specOf(request), signer);
    const record: WalletTransfer = {
      id: submitted.hash,
      kind: "send",
      // 广播成功≠上链成功，所以是 submitted 而不是 confirmed
      status: "submitted",
      hash: submitted.hash,
      token: request.token,
      amount: request.amount,
      counterparty: request.to,
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.submitted.set(submitted.hash, {
      chain,
      from: request.from,
      transfer: record,
    });
    return record;
  }

  /**
   * 手续费预估与原生币上限。
   *
   * 用 1 wei 估算而不是用户输入的金额：`eth_estimateGas` 在余额不足时会 revert，
   * 用户边输入边估算必然撞上；而 ERC-20 `transfer` 的 gas 与金额无关，原生币转账
   * 的 gas 也是固定的 21000，用 1 wei 估出来的值就是要付的值。
   */
  async quote(request: SendRequest): Promise<TransferQuote> {
    const chain = request.token.chain;
    const { transfer } = this.serviceFor(chain);
    const spec = { ...this.specOf(request), amount: 1n };
    const native = CHAINS[chain];
    const toNative = (value: bigint): Money =>
      money(value, native.nativeDecimals, native.nativeSymbol);
    const fee = await transfer.estimateFee(spec);
    if (request.token.address !== NATIVE)
      return { fee: toNative(fee), maxAmount: null };
    // 原生币的"全部"必须扣掉手续费，否则这一笔必然失败，而用户会反复重试
    const max = await transfer.maxNativeAmount(spec);
    return { fee: toNative(fee), maxAmount: toNative(max) };
  }

  /**
   * 查一笔已提交交易的状态。
   *
   * 三种结果要分清：还没上链（保持 confirming，可能在内存池里）、链上成功、
   * 链上 revert（钱花了 gas 但没成功——和"网络失败"完全不同，不能混为一谈）。
   */
  async getTransaction(id: string): Promise<Tx | null> {
    const known = this.submitted.get(id);
    if (!known) return null;
    const { chain } = this.serviceFor(known.chain);
    const receipt = await chain.getReceipt(id);
    const status: Tx["status"] = !receipt
      ? "confirming"
      : receipt.status === "success"
        ? "confirmed"
        : "failed";
    const next: WalletTransfer = {
      ...known.transfer,
      status,
      // 链上 revert 有专门的文案：用户需要知道 gas 花掉了
      reasonKey: status === "failed" ? "tx.reverted" : undefined,
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.submitted.set(id, { ...known, transfer: next });
    return next;
  }

  /**
   * 本次会话里从这个地址发出的链上转账。
   *
   * Mock 账本不认识真链上的交易，不在这里补上，用户转完账回到列表会发现记录不见了。
   * 只有内存里这一份：完整的链上历史需要索引服务（`eth_getLogs` 有区块范围限制），
   * 不属于这一层。
   */
  listTransfers(address: string): WalletTransfer[] {
    const key = address.toLowerCase();
    return [...this.submitted.values()]
      .filter((entry) => entry.from.toLowerCase() === key)
      .map((entry) => entry.transfer)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private specOf(request: SendRequest) {
    return {
      from: request.from,
      to: request.to,
      chainId: evmChainIdOf(request.token.chain),
      tokenAddress: request.token.address,
      tokenSymbol: request.token.symbol,
      // 手续费花的是链的原生币，不是被转的代币——写错会让"没 gas"提示说错币种
      nativeSymbol: CHAINS[request.token.chain].nativeSymbol,
      amount: BigInt(request.amount.raw),
      maxFeeWei: request.maxFee ? BigInt(request.maxFee.raw) : undefined,
    };
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private serviceFor(chain: ChainId): {
    chain: ChainClient;
    transfer: TransferService;
  } {
    const endpoints = rpcUrlsFor(chain);
    if (endpoints.length === 0)
      throw new Error(`no rpc endpoint delivered for ${chain}`);
    const key = endpoints.join("|");
    const existing = this.services.get(chain);
    // 端点变了就重建：租户换了节点之后不该继续用旧的
    if (existing && existing.endpoints === key) return existing;
    const chainClient =
      this.deps.createChain?.(endpoints) ??
      new ChainClient(createRpcClient(endpoints));
    const entry = {
      endpoints: key,
      chain: chainClient,
      transfer: new TransferService({
        chain: chainClient,
        reason: this.deps.reason,
      }),
    };
    this.services.set(chain, entry);
    return entry;
  }
}
