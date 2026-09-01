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

/**
 * 手续费的绝对红线：10000 Gwei。
 *
 * 这不是"合理值上限"，而是"绝对不可能合理"的红线——以太坊历史峰值也没到这个量级。
 * 它挡的是被篡改或算错的费用参数（一个虚高的 maxFeePerGas 会把用户的原生币
 * 全部烧成手续费）。真正贴近市场的相对上限由链层按当前 gasPrice 判断，两层都要有。
 */
const MAX_FEE_WEI_CEILING = 10_000n * 1_000_000_000n;

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
  if (transaction.maxFeePerGas > MAX_FEE_WEI_CEILING)
    throw new UnsignableTransactionError(
      "手续费高得不合理，拒绝签名（可能是费用参数被篡改或算错）",
    );
}
