import type { TypedDataDomain, TypedDataField } from "ethers";

/**
 * 签名器抽象：内置自托管钱包与外部钱包（WalletConnect）都实现它。
 * 业务层只拿签名结果，永远拿不到私钥。
 */
export type SignRequestContext = {
  /** 展示在系统验证弹窗 / 外部钱包里的说明文案（已 i18n） */
  reason: string;
};

export type EvmTransactionRequest = {
  chainId: number;
  to?: string;
  from?: string;
  value?: bigint;
  data?: string;
  nonce?: number;
  gasLimit?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
};

export interface WalletSigner {
  readonly address: string;
  /**
   * 这个签名器是否自己管 nonce 与手续费。
   *
   * 外部钱包（`eth_sendTransaction`）自己算，替它查 nonce 和 gas 既浪费三次 RPC，
   * 也可能和它自己的取值冲突。内置钱包相反——它什么都不知道，全靠链层准备。
   */
  readonly managesOwnFees: boolean;
  /** EIP-191 personal_sign，SIWE 登录用它 */
  signMessage(message: string, context: SignRequestContext): Promise<string>;
  /** EIP-712 结构化签名（下单 / 授权） */
  signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
    context: SignRequestContext,
  ): Promise<string>;
  /**
   * 提交交易，返回 txHash。
   *
   * 为什么不是"签名后由链层广播"：**MetaMask 不支持 `eth_signTransaction`**，
   * 外部钱包只能走 `eth_sendTransaction`——它自己管 nonce、自己估 gas、自己签名
   * 并广播，只把 txHash 还回来。所以"签名"和"广播"这条缝在外部钱包上不存在，
   * 强行分离会写出一个走不通的接口。
   *
   * 两条实现的差异收在这里：
   * - 内置钱包：本地签名，然后用传入的 `broadcast` 发出去（签名器不碰网络）；
   * - 外部钱包：忽略 `broadcast`，整笔交给钱包 App。
   *
   * @param broadcast 把已签名的原始交易发出去并返回 txHash
   */
  submitTransaction(
    transaction: EvmTransactionRequest,
    context: SignRequestContext,
    broadcast: (signedTransaction: string) => Promise<string>,
  ): Promise<string>;
}
