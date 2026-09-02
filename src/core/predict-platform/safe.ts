import {
  Interface,
  getAddress,
  solidityPacked,
  type TypedDataDomain,
  type TypedDataField,
} from "ethers";
import { ZERO_ADDRESS } from "./contracts";

/**
 * 用户的 Safe 代理钱包相关的签名与编码，与 user-dapp 一致：
 * - `CreateProxy`：部署 Safe（`useSetupSteps.ts:32-41,329-333`）；
 * - `SafeTx`：Safe v1.3 交易，domain 只有 chainId + verifyingContract（`initiateUnwrap.ts:30-43`）；
 * - MultiSend：`multiSend(bytes)`，每条 op 打包为 operation(1) | to(20) | value(32) | dataLen(32) | data。
 */

const multiSendInterface = new Interface([
  "function multiSend(bytes transactions)",
]);

/** 内层调用只有 call（operation 0）且不带 value：relayer 两者都拒绝（`handler.go:701-720`） */
export type MultiSendOp = { to: string; data: string };

export function encodeMultiSend(ops: MultiSendOp[]): string {
  const packed = ops
    .map((op) =>
      solidityPacked(
        ["uint8", "address", "uint256", "uint256", "bytes"],
        [0, getAddress(op.to), 0n, (op.data.length - 2) / 2, op.data],
      ).slice(2),
    )
    .join("");
  return multiSendInterface.encodeFunctionData("multiSend", [`0x${packed}`]);
}

export const SAFE_TX_TYPES: Record<string, TypedDataField[]> = {
  SafeTx: [
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "operation", type: "uint8" },
    { name: "safeTxGas", type: "uint256" },
    { name: "baseGas", type: "uint256" },
    { name: "gasPrice", type: "uint256" },
    { name: "gasToken", type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce", type: "uint256" },
  ],
};

export type SafeTx = {
  to: string;
  data: string;
  /** 0 = call，1 = delegatecall（MultiSend 必须 1） */
  operation: 0 | 1;
  nonce: bigint;
};

export function safeTxTypedData(
  chainId: number,
  safe: string,
  tx: SafeTx,
): {
  domain: TypedDataDomain;
  types: Record<string, TypedDataField[]>;
  value: Record<string, unknown>;
} {
  return {
    domain: { chainId, verifyingContract: getAddress(safe) },
    types: SAFE_TX_TYPES,
    value: {
      to: getAddress(tx.to),
      value: 0n,
      data: tx.data,
      operation: tx.operation,
      safeTxGas: 0n,
      baseGas: 0n,
      gasPrice: 0n,
      gasToken: ZERO_ADDRESS,
      refundReceiver: ZERO_ADDRESS,
      nonce: tx.nonce,
    },
  };
}

/** relayer `POST /submit` 里 SafeTx 对应的 `signatureParams`。 */
export function safeTxSignatureParams(
  operation: 0 | 1,
): Record<string, string> {
  return {
    gasPrice: "0",
    operation: String(operation),
    safeTxnGas: "0",
    baseGas: "0",
    gasToken: ZERO_ADDRESS,
    refundReceiver: ZERO_ADDRESS,
  };
}

export const CREATE_PROXY_TYPES: Record<string, TypedDataField[]> = {
  CreateProxy: [
    { name: "paymentToken", type: "address" },
    { name: "payment", type: "uint256" },
    { name: "paymentReceiver", type: "address" },
    { name: "scopeId", type: "bytes32" },
  ],
};

export function createProxyTypedData(
  chainId: number,
  factory: string,
  scopeId: string,
): {
  domain: TypedDataDomain;
  types: Record<string, TypedDataField[]>;
  value: Record<string, unknown>;
} {
  return {
    domain: {
      name: "Polymarket Contract Proxy Factory",
      chainId,
      verifyingContract: getAddress(factory),
    },
    types: CREATE_PROXY_TYPES,
    value: {
      paymentToken: ZERO_ADDRESS,
      payment: 0n,
      paymentReceiver: ZERO_ADDRESS,
      scopeId,
    },
  };
}

export function createProxySignatureParams(
  scopeId: string,
): Record<string, string> {
  return {
    paymentToken: ZERO_ADDRESS,
    payment: "0",
    paymentReceiver: ZERO_ADDRESS,
    scopeId,
  };
}
