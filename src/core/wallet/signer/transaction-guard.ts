import { getAddress } from "ethers";
import type { EvmTransactionRequest } from "./types";

/**
 * 签名前的字段体检。
 *
 * 为什么必须有：ethers 的 `Wallet.signTransaction` **缺字段不报错**——只给
 * chainId/to/value 也签得出来，用的是默认值（nonce=0、gasLimit=0）。这比抛异常
 * 危险得多：nonce=0 可能重放一笔很久以前的交易。所以完整性只能由我们自己保证，
 * 不能指望库拦。
 */

export class UnsignableTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsignableTransactionError";
  }
}

const GWEI = 1_000_000_000n;

/**
 * 每条链的 maxFeePerGas 绝对红线（按 EIP-155 chainId）。
 *
 * 为什么按链：链层那道"不超过节点报的 gasPrice 四倍"的相对上限，对**恶意节点**
 * 是无效的——基准 gasPrice 也是它报的。所以绝对红线才是恶意节点面前唯一的防线，
 * 而一条与链无关的 10000 Gwei 对 BSC（常态 1～3 Gwei）是三千倍常态，一笔 ERC-20
 * 转账最多能被烧掉 0.6 BNB。
 *
 * 取值原则："历史极端拥堵值的几倍"，保证正常拥堵不误拒、恶意节点能造成的损失
 * 有界：以太坊历史极端约 1000 Gwei，BSC 约 20～50，Base / OP 常态不到 1。
 * 目录里没有的链退回 10000 Gwei——总比没有强。
 */
const MAX_FEE_PER_GAS_BY_CHAIN: Record<number, bigint> = {
  1: 2_000n * GWEI,
  56: 200n * GWEI,
  8453: 100n * GWEI,
  11155420: 100n * GWEI,
};
const MAX_FEE_WEI_CEILING = 10_000n * GWEI;

/** 供测试与文档：某条链的红线。 */
export function maxFeePerGasCeiling(chainId: number): bigint {
  return MAX_FEE_PER_GAS_BY_CHAIN[chainId] ?? MAX_FEE_WEI_CEILING;
}

/** 任何提交路径都必须满足的部分（外部钱包会自己补 nonce 与手续费）。 */
export function assertSubmittable(transaction: EvmTransactionRequest): void {
  if (!Number.isInteger(transaction.chainId) || transaction.chainId <= 0)
    throw new UnsignableTransactionError("chainId 缺失或不合法");
  if (transaction.to === undefined)
    throw new UnsignableTransactionError("缺少收款地址");
  try {
    // 顺带做 EIP-55 校验：全小写地址合法（交易所常给小写），混合大小写必须校验和正确
    getAddress(transaction.to);
  } catch {
    throw new UnsignableTransactionError(`收款地址不合法：${transaction.to}`);
  }
  if (transaction.value === undefined && !transaction.data)
    throw new UnsignableTransactionError("既没有转账金额也没有调用数据");
}

/**
 * 本地签名额外需要的字段。外部钱包不走这条——它自己管 nonce 和手续费，
 * 我们既不知道也不该猜。
 */
export function assertLocallySignable(
  transaction: EvmTransactionRequest,
): void {
  assertSubmittable(transaction);
  if (transaction.nonce === undefined)
    throw new UnsignableTransactionError(
      "缺少 nonce：ethers 会默认填 0，可能重放一笔旧交易",
    );
  if (!Number.isInteger(transaction.nonce) || transaction.nonce < 0)
    throw new UnsignableTransactionError(`nonce 不合法：${transaction.nonce}`);
  if (transaction.gasLimit === undefined || transaction.gasLimit <= 0n)
    throw new UnsignableTransactionError("缺少 gasLimit");
  if (transaction.maxFeePerGas === undefined || transaction.maxFeePerGas <= 0n)
    throw new UnsignableTransactionError("缺少 maxFeePerGas");
  if (transaction.maxPriorityFeePerGas === undefined)
    throw new UnsignableTransactionError("缺少 maxPriorityFeePerGas");
  if (transaction.maxPriorityFeePerGas > transaction.maxFeePerGas)
    throw new UnsignableTransactionError(
      "maxPriorityFeePerGas 不能大于 maxFeePerGas",
    );
  if (transaction.maxFeePerGas > maxFeePerGasCeiling(transaction.chainId))
    throw new UnsignableTransactionError(
      "手续费高得不合理，拒绝签名（可能是费用参数被篡改或算错）",
    );
}
