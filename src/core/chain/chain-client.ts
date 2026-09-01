import { Interface } from "ethers";
import { RpcError, type RpcClient } from "./rpc-client";

/**
 * 一条链上的读写操作。
 *
 * 职责边界：这里**只**负责和节点对话并把结果解成类型，不做业务判断。
 * "余额够不够""这个费用合不合理"属于调用方；"这笔交易字段全不全"属于
 * `core/wallet/signer/transaction-guard`。
 *
 * 节点不可信这件事在两个地方体现：nonce 有本地单调性校验（错误的 nonce 会诱导
 * 重放），手续费有相对上限（虚高的 gasPrice 会把用户的原生币烧成手续费）。
 */

/** 所有主流 EVM 链上的同一份部署，实测 bsc / eth / base / op-sepolia 字节码一致。 */
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";

const erc20 = new Interface([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

const multicall3 = new Interface([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[] returnData)",
]);

/** 手续费相对上限：不超过节点报的 gasPrice 的这个倍数。 */
const FEE_HEADROOM_MULTIPLIER = 4n;

/**
 * pending 与 latest 两个 nonce 之间允许的最大差距。
 *
 * 差距就是这个地址在内存池里排队的交易数。一个普通用户不会同时排着几十笔；
 * 节点报出一个远超此数的 pending nonce，要么它在撒谎，要么它坏了——两种情况下
 * 按它给的 nonce 签出去的交易都会因为前面有空洞而永远不上链，而且本地下限一旦被
 * 抬到那个值，之后每一笔都会卡住。
 */
const MAX_PENDING_GAP = 32;

const QUANTITY = /^0x[0-9a-fA-F]+$/;

/**
 * 解析 JSON-RPC 的 QUANTITY。
 *
 * 节点是不可信的：返回 `"0x"`、空串、十进制或垃圾时，`BigInt()` 抛的是
 * SyntaxError，上层只会把它翻译成一句"转出失败"。归一成 RpcError 之后，
 * 界面能说"节点返回了异常数据"，日志里也能看到原文。
 */
function parseQuantity(raw: unknown): bigint {
  if (typeof raw !== "string" || !QUANTITY.test(raw))
    throw new RpcError(
      "node returned a malformed quantity",
      undefined,
      String(raw),
    );
  return BigInt(raw);
}

export class ChainClient {
  /** 本地记住发出去的最大 nonce，节点报一个更小的值时不采纳 */
  private readonly highestNonce = new Map<string, number>();

  constructor(private readonly rpc: RpcClient) {}

  async getNativeBalance(address: string): Promise<bigint> {
    const raw = await this.rpc.call<string>("eth_getBalance", [
      address,
      "latest",
    ]);
    return parseQuantity(raw);
  }

  /**
   * 一次请求拿多个代币余额。
   *
   * 逐个 `balanceOf` 会让公共节点直接限流，所以走 Multicall3 的 aggregate3。
   * `allowFailure` 开着：某个代币查失败不该让整批都拿不到，调用方按缺失处理。
   */
  async getTokenBalances(
    address: string,
    contracts: string[],
  ): Promise<Map<string, bigint>> {
    const balances = new Map<string, bigint>();
    if (contracts.length === 0) return balances;
    const callData = erc20.encodeFunctionData("balanceOf", [address]);
    const data = multicall3.encodeFunctionData("aggregate3", [
      contracts.map((target) => [target, true, callData]),
    ]);
    const raw = await this.rpc.call<string>("eth_call", [
      { to: MULTICALL3, data },
      "latest",
    ]);
    const [results] = multicall3.decodeFunctionResult(
      "aggregate3",
      raw,
    ) as unknown as [{ success: boolean; returnData: string }[]];
    results.forEach((result, index) => {
      const contract = contracts[index];
      if (!contract || !result.success) return;
      try {
        const [value] = erc20.decodeFunctionResult(
          "balanceOf",
          result.returnData,
        ) as unknown as [bigint];
        balances.set(contract.toLowerCase(), value);
      } catch {
        // 返回的不是一个 uint256：当作查不到，别把垃圾当余额显示
      }
    });
    return balances;
  }

  /**
   * 下一个可用的 nonce。
   *
   * 取 `pending` 而不是 `latest`：还在内存池里的交易也要计入，否则连续两笔会撞。
   * 再叠一层本地单调性——被篡改或落后的节点报一个更小的 nonce，会让用户签出一笔
   * 重放旧交易的签名。
   *
   * 反方向也要防：节点报一个**过大**的 pending nonce 时，签出去的交易会因为前面
   * 有空洞永远不上链。所以同时取 `latest` 做一致性检查，两者差距超过一个普通
   * 用户可能排队的笔数就拒绝。本地下限只由 `noteNonceUsed` 抬高，不采纳节点的值——
   * 否则一次坏响应就会把之后每一笔都卡住。
   */
  async getNextNonce(address: string): Promise<number> {
    const [pendingRaw, latestRaw] = await Promise.all([
      this.rpc.call<string>("eth_getTransactionCount", [address, "pending"]),
      this.rpc.call<string>("eth_getTransactionCount", [address, "latest"]),
    ]);
    const pending = Number(parseQuantity(pendingRaw));
    const latest = Number(parseQuantity(latestRaw));
    if (pending < latest || pending - latest > MAX_PENDING_GAP)
      throw new RpcError(
        "node returned an inconsistent nonce",
        undefined,
        `pending=${pending} latest=${latest}`,
      );
    const floor = this.highestNonce.get(address.toLowerCase());
    return floor !== undefined && floor > pending ? floor : pending;
  }

  /** 记下已经用掉的 nonce，下一笔从它之后开始。 */
  noteNonceUsed(address: string, nonce: number): void {
    const key = address.toLowerCase();
    const floor = this.highestNonce.get(key) ?? -1;
    if (nonce + 1 > floor) this.highestNonce.set(key, nonce + 1);
  }

  /**
   * EIP-1559 手续费。
   *
   * 公式对四条链都成立（BSC 的 baseFee 恒为 0，自然退化成只有 priority）。
   * `eth_gasPrice` 有两个用处：当下限（节点报的 priority 可能低于网络实际接受的
   * 最低值，那样交易会永久 pending），以及当相对上限的基准。
   */
  async getFeeData(): Promise<{
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  }> {
    const [block, gasPrice, priority] = await Promise.all([
      this.rpc.call<{ baseFeePerGas?: string }>("eth_getBlockByNumber", [
        "latest",
        false,
      ]),
      this.rpc.call<string>("eth_gasPrice"),
      this.rpc
        .call<string>("eth_maxPriorityFeePerGas")
        .catch(() => null as string | null),
    ]);
    const base = block?.baseFeePerGas ? parseQuantity(block.baseFeePerGas) : 0n;
    const reference = parseQuantity(gasPrice);
    const tip = priority === null ? reference : parseQuantity(priority);
    const computed = base * 2n + tip;
    // 下限：算出来比节点报的 gasPrice 还低时，用 gasPrice
    const maxFeePerGas = computed > reference ? computed : reference;
    const ceiling = reference * FEE_HEADROOM_MULTIPLIER;
    if (maxFeePerGas > ceiling)
      throw new Error(
        `fee estimate ${maxFeePerGas} exceeds ${FEE_HEADROOM_MULTIPLIER}x the reported gas price`,
      );
    return {
      maxFeePerGas,
      maxPriorityFeePerGas: tip > maxFeePerGas ? maxFeePerGas : tip,
    };
  }

  /**
   * gas 估算。
   *
   * 加 buffer 是必须的：估算值随收款方状态浮动（同一笔 USDT 转账，收款地址已有
   * 余额时约 34.6k，从零变非零时约 29.8k）。余额不足时节点会 revert，调用方应该
   * 在这之前自己比过余额。
   */
  async estimateGas(transaction: {
    from: string;
    to: string;
    value?: bigint;
    data?: string;
  }): Promise<bigint> {
    const raw = await this.rpc.call<string>("eth_estimateGas", [
      {
        from: transaction.from,
        to: transaction.to,
        value: transaction.value ? toHex(transaction.value) : undefined,
        data: transaction.data,
      },
    ]);
    return (parseQuantity(raw) * 12n) / 10n;
  }

  async broadcast(signedTransaction: string): Promise<string> {
    return this.rpc.call<string>("eth_sendRawTransaction", [signedTransaction]);
  }

  /**
   * null = 还没上链（可能在内存池里，也可能被丢了）。
   *
   * 回执必须是**这一笔**的：节点把别的交易的回执塞回来，界面就会把一笔没发生的
   * 转账显示成已确认。对不上就当没查到，并留 warning——这是轮询路径，抛错只会让
   * 进度页退回初始态，比继续等更糟。
   */
  async getReceipt(
    hash: string,
  ): Promise<{ status: "success" | "reverted"; blockNumber: number } | null> {
    const receipt = await this.rpc.call<{
      transactionHash?: string;
      status?: string;
      blockNumber?: string;
    } | null>("eth_getTransactionReceipt", [hash]);
    if (!receipt || !receipt.blockNumber) return null;
    if (receipt.transactionHash?.toLowerCase() !== hash.toLowerCase()) {
      console.warn(
        `[chain] 回执的 transactionHash 与查询的不一致，忽略：${receipt.transactionHash}`,
      );
      return null;
    }
    return {
      // status 0x0 是链上 revert：钱花了 gas 但没成功，和"网络失败"完全不同。
      // 按数值比而不是按字符串比：有的节点会写成 0x01
      status: parseQuantity(receipt.status) === 1n ? "success" : "reverted",
      blockNumber: Number(parseQuantity(receipt.blockNumber)),
    };
  }

  /** ERC-20 转账的 calldata。原生币转账不用它。 */
  static transferData(to: string, amount: bigint): string {
    return erc20.encodeFunctionData("transfer", [to, amount]);
  }
}

function toHex(value: bigint): string {
  return `0x${value.toString(16)}`;
}
