import { getAddress, type TypedDataDomain, type TypedDataField } from "ethers";
import { randomBytes } from "@noble/hashes/utils.js";
import { z } from "zod";
import type { PredictServiceConfig } from "../config/bootstrap.schema";
import type { SignRequestContext, WalletSigner } from "../wallet/signer/types";
import { clobServerTime, l2Headers, type ClobCredentials } from "./clob-auth";
import { ZERO_ADDRESS } from "./contracts";
import { platformHosts, platformRequest } from "./tenant-client";

/**
 * 订单签名与提交，照 user-dapp `hooks/useOrderSigning.ts` 与 `ClosePositionModal.tsx:326-343`：
 * - domain `{name:"Prediction Market Protocol", version:"1", chainId, verifyingContract}`，
 *   verifyingContract 是 CTF Exchange，negRisk 市场用 NegRisk Exchange；
 * - maker = Safe、signer = EOA、taker = 0x0、nonce 0、signatureType 2（POLY_GNOSIS_SAFE）、
 *   salt 随机 uint32、expiration 只有 GTD 非 0、feeRateBps 取 `/fee-rate`、scopeId 是租户 scopeId；
 * - `POST {clob}/order` body `{order, orderType, deferExec:false, postOnly:false}`，L2 头按 path + body 签。
 */

export const ORDER_TYPES: Record<string, TypedDataField[]> = {
  Order: [
    { name: "salt", type: "uint256" },
    { name: "maker", type: "address" },
    { name: "signer", type: "address" },
    { name: "taker", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "makerAmount", type: "uint256" },
    { name: "takerAmount", type: "uint256" },
    { name: "expiration", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "feeRateBps", type: "uint256" },
    { name: "side", type: "uint8" },
    { name: "signatureType", type: "uint8" },
    { name: "scopeId", type: "bytes32" },
  ],
};

/** `signatureType` 枚举里的 POLY_GNOSIS_SAFE（`useOrderSigning.ts:185`） */
export const SIGNATURE_TYPE_SAFE = 2;

export type OrderType = "FAK" | "GTC" | "GTD";
export type OrderSide = "BUY" | "SELL";

export type OrderDraft = {
  chainId: number;
  /** CTF Exchange；negRisk 市场传 NegRisk Exchange */
  exchange: string;
  scopeId: string;
  safe: string;
  tokenId: string;
  side: OrderSide;
  makerAmount: bigint;
  takerAmount: bigint;
  feeRateBps: number;
  orderType: OrderType;
  /** GTD 的到期秒；其它单型为 0 */
  expirationSeconds: number;
  salt?: bigint;
};

export function orderDomain(
  chainId: number,
  exchange: string,
): TypedDataDomain {
  return {
    name: "Prediction Market Protocol",
    version: "1",
    chainId,
    verifyingContract: getAddress(exchange),
  };
}

function randomSalt(): bigint {
  const bytes = randomBytes(4);
  return (
    BigInt(
      (bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!,
    ) & 0xffffffffn
  );
}

export function orderValue(
  draft: OrderDraft,
  signer: string,
): Record<string, unknown> {
  if (draft.orderType === "GTD" && draft.expirationSeconds <= 0)
    throw new Error("a GTD order needs an expiration");
  return {
    salt: draft.salt ?? randomSalt(),
    maker: getAddress(draft.safe),
    signer: getAddress(signer),
    taker: ZERO_ADDRESS,
    tokenId: BigInt(draft.tokenId),
    makerAmount: draft.makerAmount,
    takerAmount: draft.takerAmount,
    expiration:
      draft.orderType === "GTD"
        ? BigInt(Math.floor(draft.expirationSeconds))
        : 0n,
    nonce: 0n,
    feeRateBps: BigInt(draft.feeRateBps),
    side: draft.side === "BUY" ? 0 : 1,
    signatureType: SIGNATURE_TYPE_SAFE,
    scopeId: draft.scopeId,
  };
}

/** 提交体里的订单：数字全是字符串，`tokenID` 大写 ID，side 是文字 */
export type SignedOrderBody = {
  salt: string;
  maker: string;
  signer: string;
  taker: string;
  tokenID: string;
  makerAmount: string;
  takerAmount: string;
  expiration: string;
  nonce: string;
  feeRateBps: string;
  side: OrderSide;
  signatureType: string;
  scopeId: string;
  signature: string;
};

export async function signOrder(
  draft: OrderDraft,
  signer: WalletSigner,
  context: SignRequestContext,
): Promise<SignedOrderBody> {
  const value = orderValue(draft, signer.address);
  const signature = await signer.signTypedData(
    orderDomain(draft.chainId, draft.exchange),
    ORDER_TYPES,
    value,
    context,
  );
  return {
    salt: String(value.salt),
    maker: value.maker as string,
    signer: value.signer as string,
    taker: ZERO_ADDRESS,
    tokenID: draft.tokenId,
    makerAmount: draft.makerAmount.toString(),
    takerAmount: draft.takerAmount.toString(),
    expiration: String(value.expiration),
    nonce: "0",
    feeRateBps: String(draft.feeRateBps),
    side: draft.side,
    signatureType: String(SIGNATURE_TYPE_SAFE),
    scopeId: draft.scopeId,
    signature,
  };
}

/** `apidoc/types.go:89-98`；`status` 是 `live` / `matched`（`shared/types/order.go:112-114`），延迟撮合时为 `delayed` */
export const sendOrderResponseSchema = z.object({
  success: z.boolean(),
  errorMsg: z.string().nullish(),
  orderID: z.string(),
  takingAmount: z.string().nullish(),
  makingAmount: z.string().nullish(),
  status: z.string(),
  transactionsHashes: z.array(z.string()).nullish(),
  tradeIDs: z.array(z.string()).nullish(),
});
export type SendOrderResponse = z.infer<typeof sendOrderResponseSchema>;

export class OrderRejectedError extends Error {
  constructor(
    readonly orderId: string,
    detail: string,
  ) {
    super(detail);
    this.name = "OrderRejectedError";
  }
}

export async function postOrder(
  service: PredictServiceConfig,
  auth: { credentials: ClobCredentials; address: string },
  order: SignedOrderBody,
  orderType: OrderType,
): Promise<SendOrderResponse> {
  const hosts = platformHosts(service.domain);
  const timestamp = await clobServerTime(service);
  const path = "/order";
  const body = { order, orderType, deferExec: false, postOnly: false };
  const result = await platformRequest({
    url: `${hosts.clob}${path}`,
    tenantDomain: service.domain,
    method: "POST",
    body,
    schema: sendOrderResponseSchema,
    // 市价单可能等结算 tx（handlers.go:168-175），给足时间
    timeoutMs: 35_000,
    headers: l2Headers(
      auth.credentials,
      auth.address,
      "POST",
      path,
      timestamp,
      JSON.stringify(body),
    ),
  });
  if (!result.success)
    throw new OrderRejectedError(
      result.orderID,
      result.errorMsg || "the platform rejected the order",
    );
  return result;
}
