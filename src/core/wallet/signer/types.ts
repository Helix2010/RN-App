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
  /** EIP-191 personal_sign，SIWE 登录用它 */
  signMessage(message: string, context: SignRequestContext): Promise<string>;
  /** EIP-712 结构化签名（下单 / 授权） */
  signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
    context: SignRequestContext,
  ): Promise<string>;
  /** 返回已签名的原始交易（十六进制），广播由链层负责 */
  signTransaction(
    transaction: EvmTransactionRequest,
    context: SignRequestContext,
  ): Promise<string>;
}
