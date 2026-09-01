import { RpcError, RpcUnavailableError } from "../../../core/chain/rpc-client";
import {
  InsufficientBalanceError,
  InsufficientGasError,
} from "../../../core/chain/transfer-service";
import { WalletAuthRequiredError } from "../../../core/wallet/vault/keystore-vault";

/**
 * 把转出失败翻译成用户能照着做的一句话。
 *
 * 为什么单独一个模块：链上失败的原因差别很大，"转出失败"这一句把它们混成了同一
 * 件事。最典型的是「有 USDT 但没有 BNB」——用户会以为余额不足而反复重试，而正确
 * 的动作是去充一点原生币。区分不了原因，用户就无法自救。
 *
 * 返回 key 而不是句子：文案要走 i18n，而且这层要能被单测覆盖。
 */
export type TransferErrorCopy = {
  key: string;
  values?: Record<string, string>;
};

export function transferErrorCopy(error: unknown): TransferErrorCopy {
  if (error instanceof InsufficientGasError)
    return { key: "send.error.gas", values: { symbol: error.nativeSymbol } };
  if (error instanceof InsufficientBalanceError)
    return { key: "send.error.balance", values: { symbol: error.symbol } };
  if (error instanceof RpcUnavailableError)
    return { key: "send.error.network" };
  // 节点接受了请求但拒绝了这笔交易（revert / nonce 太低 / gas 过低）。
  // 节点原文在 detail 里，只进日志——里面是合约内部话，给用户看只会更困惑。
  if (error instanceof RpcError) return { key: "send.error.node" };
  if (error instanceof WalletAuthRequiredError)
    return {
      key:
        error.outcome === "cancelled"
          ? "send.error.rejected"
          : "send.error.authFailed",
    };
  // WalletConnect 的错误类型按 name 判断：instanceof 会把 WalletConnect SDK
  // 拖进转出界面的模块图，而这些类都显式设了 name，本身就是对外契约。
  const name = error instanceof Error ? error.name : "";
  if (name === "WalletConnectRejectedError")
    return { key: "send.error.rejected" };
  if (name === "WalletConnectTimeoutError")
    return { key: "send.error.timeout" };
  // 缺字段的交易被本地守卫拦下了。用户无法自救，但必须知道钱没有动。
  if (name === "UnsignableTransactionError")
    return { key: "send.error.unsafe" };
  return { key: "send.failed" };
}
