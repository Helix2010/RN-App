import {
  CHAINS,
  type KeyValueStorage,
  NATIVE_TOKEN_ADDRESS,
  type ChainId,
  type Tx,
} from "../../../core/gateways/types";
import { money, type Money } from "../../../core/money/money";
import { ChainClient } from "../../../core/chain/chain-client";
import { createRpcClient } from "../../../core/chain/rpc-client";
import { TransferService } from "../../../core/chain/transfer-service";
import {
  ContractCallService,
  type ContractCall,
  type SubmittedCall,
} from "../../../core/chain/contract-call-service";
import type { WalletSigner } from "../../../core/wallet/signer/types";
import {
  evmChainIdOf,
  onchainSendsEnabled,
  rpcUrlsFor,
} from "../../../core/wallet/config/wallet-runtime-config";
import type {
  SendRequest,
  TransferQuote,
  WalletTransfer,
} from "../model/wallet";

/** 内存里最多记这么多笔：进度只在提交后几分钟内有意义，更早的去区块浏览器看。 */
const MAX_TRACKED = 50;
const SENDS_KEY = "foundation.wallet.sends.v1";
type SubmittedRecord = {
  chain: ChainId;
  from: string;
  transfer: WalletTransfer;
};

/**
 * 真实链上的转出。
 *
 * 一条链只有在**租户显式开了 `onchainSends`** 且服务端下发了 RPC 端点时才走
 * 真链；租户没开时是显式的演示账本状态。曾经想用"有没有端点"当开关，但服务端对没配过
 * 端点的租户也会下发平台默认端点——那不是开关，是常开。
 *
 * 每条链一套客户端，惰性创建：没人转那条链就不该建连接。端点实时读取，不重建。
 */
export class OnchainTransfers {
  private readonly services = new Map<
    ChainId,
    {
      chain: ChainClient;
      transfer: TransferService;
      calls: ContractCallService;
    }
  >();
  /**
   * txHash → 这笔转账的链与快照。本机发出过的转账（记录页"钱包转账"Tab 的正式来源），
   * 落普通存储，冷启动后仍在；未到终态的在读取时按回执推进。
   * 完整的链上历史（别人打进来的）需要索引服务（`eth_getLogs` 有区块范围限制），不在这一层。
   */
  private readonly submitted = new Map<string, SubmittedRecord>();
  private hydrated: Promise<void> | null = null;

  constructor(
    private readonly deps: {
      /** 签名弹窗 / 外部钱包里显示的说明，已 i18n */
      reason: string;
      storage: KeyValueStorage;
      now?: () => number;
      /** 仅供测试替换：默认按下发的端点建真实客户端。参数是端点的实时读取函数 */
      createChain?: (endpoints: () => string[]) => ChainClient;
    },
  ) {}

  /** 第一次用到记录时从存储读一次；坏了就从头开始记（留痕） */
  private hydrate(): Promise<void> {
    if (!this.hydrated)
      this.hydrated = (async () => {
        const raw = await this.deps.storage.getItem(SENDS_KEY);
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (!Array.isArray(parsed)) return;
          for (const item of parsed as SubmittedRecord[])
            if (item?.transfer?.id && !this.submitted.has(item.transfer.id))
              this.submitted.set(item.transfer.id, item);
        } catch (error) {
          console.warn("[wallet] send ledger is corrupt, starting over", error);
        }
      })();
    return this.hydrated;
  }

  private async persist(): Promise<void> {
    await this.deps.storage.setItem(
      SENDS_KEY,
      JSON.stringify([...this.submitted.values()]),
    );
  }

  available(chain: ChainId): boolean {
    // 两个条件缺一不可：租户显式开了链上转出，且这条链有端点可用
    return onchainSendsEnabled() && rpcUrlsFor(chain).length > 0;
  }

  /**
   * 原生币的链上余额。
   *
   * 原生币不需要代币目录（没有合约、精度固定），所以在目录落地之前就能先把它
   * 接到真链上——这也是转出走真链之后必须做的：转出扣的是真钱，余额却停在演示
   * 数字上，用户会以为钱没转出去。
   */
  async nativeBalance(chain: ChainId, address: string): Promise<bigint> {
    return this.serviceFor(chain).chain.getNativeBalance(address);
  }

  /**
   * 一批代币的链上余额（Multicall3，一次请求）。
   *
   * 目录来自服务端下发，这一层只负责问链、不判断该问哪些；结果键是小写合约地址，
   * 查不到的合约不在结果里，交给网关按缺失处理。
   */
  async tokenBalances(
    chain: ChainId,
    address: string,
    contracts: string[],
  ): Promise<Map<string, bigint>> {
    return this.serviceFor(chain).chain.getTokenBalances(address, contracts);
  }

  /** 任意合约调用（预测平台的 approve / wrap 等）。签名器由调用方按账户解析。 */
  async callContract(
    chain: ChainId,
    call: Omit<ContractCall, "chainId" | "nativeSymbol">,
    signer: WalletSigner,
  ): Promise<SubmittedCall> {
    return this.serviceFor(chain).calls.submit(
      this.callOf(chain, call),
      signer,
    );
  }

  async estimateCall(
    chain: ChainId,
    call: Omit<ContractCall, "chainId" | "nativeSymbol">,
  ): Promise<bigint> {
    return this.serviceFor(chain).calls.estimateFee(this.callOf(chain, call));
  }

  /** 只读调用；结果是 ABI 编码的 hex，由调用方解码。 */
  async readContract(
    chain: ChainId,
    to: string,
    data: string,
  ): Promise<string> {
    return this.serviceFor(chain).chain.call(to, data);
  }

  /** 回执里的日志；null = 还没上链。 */
  async receiptLogs(
    chain: ChainId,
    hash: string,
  ): Promise<{ address: string; topics: string[]; data: string }[] | null> {
    return this.serviceFor(chain).chain.getReceiptLogs(hash);
  }

  /** 某条链上一笔交易的回执状态；null = 还没上链。 */
  async receiptOf(
    chain: ChainId,
    hash: string,
  ): Promise<{ status: "success" | "reverted"; blockNumber: number } | null> {
    return this.serviceFor(chain).chain.getReceipt(hash);
  }

  private callOf(
    chain: ChainId,
    call: Omit<ContractCall, "chainId" | "nativeSymbol">,
  ): ContractCall {
    return {
      ...call,
      chainId: evmChainIdOf(chain),
      nativeSymbol: CHAINS[chain].nativeSymbol,
    };
  }

  async send(
    request: SendRequest,
    signer: WalletSigner,
  ): Promise<WalletTransfer> {
    const chain = request.token.chain;
    const { transfer } = this.serviceFor(chain);
    await this.hydrate();
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
    // Map 保持插入顺序：超出上限就丢最早的
    while (this.submitted.size > MAX_TRACKED) {
      const oldest = this.submitted.keys().next().value;
      if (oldest === undefined) break;
      this.submitted.delete(oldest);
    }
    await this.persist();
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
    if (request.token.address !== NATIVE_TOKEN_ADDRESS)
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
    await this.hydrate();
    const known = this.submitted.get(id);
    if (!known) return null;
    return this.refresh(known);
  }

  /** 按回执推进一条记录并落盘；已到终态的原样返回 */
  private async refresh(known: SubmittedRecord): Promise<WalletTransfer> {
    const current = known.transfer;
    if (current.status === "confirmed" || current.status === "failed")
      return current;
    const { chain } = this.serviceFor(known.chain);
    const receipt = await chain.getReceipt(current.id);
    const status: Tx["status"] = !receipt
      ? "confirming"
      : receipt.status === "success"
        ? "confirmed"
        : "failed";
    const next: WalletTransfer = {
      ...current,
      status,
      // 链上 revert 有专门的文案：用户需要知道 gas 花掉了
      reasonKey: status === "failed" ? "tx.reverted" : undefined,
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.submitted.set(current.id, { ...known, transfer: next });
    if (status !== current.status) await this.persist();
    return next;
  }

  /**
   * 从这个地址发出过的链上转账（本机账本，跨冷启动）。未到终态的先按回执推进一次，
   * 进度页没开着也不会一直停在"已提交"。收款（别人打进来的）需要索引服务，不在这一层。
   */
  async listTransfers(address: string): Promise<WalletTransfer[]> {
    await this.hydrate();
    const key = address.toLowerCase();
    const mine = [...this.submitted.values()].filter(
      (entry) => entry.from.toLowerCase() === key,
    );
    const items: WalletTransfer[] = [];
    for (const entry of mine) {
      if (
        entry.transfer.status === "confirmed" ||
        entry.transfer.status === "failed" ||
        !this.available(entry.chain)
      ) {
        items.push(entry.transfer);
        continue;
      }
      try {
        items.push(await this.refresh(entry));
      } catch (error) {
        // 节点这次没答上：保留上次的状态，不把一笔真实交易显示成消失或失败
        console.warn(`[wallet] ${entry.chain} 回执查询失败`, error);
        items.push(entry.transfer);
      }
    }
    return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
    calls: ContractCallService;
  } {
    if (rpcUrlsFor(chain).length === 0)
      throw new Error(`no rpc endpoint delivered for ${chain}`);
    const existing = this.services.get(chain);
    if (existing) return existing;
    // 端点通过函数实时读取：租户换了节点立刻生效，而客户端上挂着的发送队列
    // 和 nonce 下限不会因此丢失（丢了在途的一笔和下一笔就会撞 nonce）
    const endpoints = () => rpcUrlsFor(chain);
    const chainClient =
      this.deps.createChain?.(endpoints) ??
      new ChainClient(createRpcClient(endpoints));
    const entry = {
      chain: chainClient,
      transfer: new TransferService({
        chain: chainClient,
        reason: this.deps.reason,
      }),
      calls: new ContractCallService({
        chain: chainClient,
        reason: this.deps.reason,
      }),
    };
    this.services.set(chain, entry);
    return entry;
  }
}
