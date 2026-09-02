import { Interface, getAddress } from "ethers";

/**
 * 平台合约的 ABI 片段（只放我们真的会调的函数与事件），与 user-dapp 里的调用一致：
 * `wrapUsdc.ts`、`initiateUnwrap.ts`、`claimUnwrap.ts`、`useSetupSteps.ts`。
 */

export const erc20 = new Interface([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

export const usdWrapper = new Interface([
  "function wrap(address asset, uint256 assetAmount, address to) returns (uint256 usdwAmount)",
  "function initiateUnwrap(uint256 usdwAmount, address asset) returns (uint256 requestId)",
  "function claimUnwrap(uint256 requestId)",
  "function unwrapDelay() view returns (uint256)",
  "function minUnwrapUsdw() view returns (uint256)",
  "event UnwrapInitiated(address indexed caller, uint256 indexed requestId, address indexed asset, uint256 usdwAmount, uint256 assetAmount, uint64 claimableAt)",
]);

export const conditionalTokens = new Interface([
  "function setApprovalForAll(address operator, bool approved)",
  "function isApprovedForAll(address owner, address operator) view returns (bool)",
  // ERC1155 余额：领取前核对 Safe 手里确实有这份仓位（`useRedeemBatch.ts` balanceOfBatch）
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  // 领取 / 拆分 / 合并（`lib/redeemBatch.ts:108-200`、`hooks/useSplitMerge.ts:30-50`）
  "function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)",
  "function splitPosition(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount)",
  "function mergePositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount)",
]);

/** negRisk 市场走 adapter（`useRedeem.ts` NEG_RISK_ADAPTER_ABI、`useSplitMerge.ts:55-80`） */
export const negRiskAdapter = new Interface([
  "function redeemPositions(bytes32 conditionId, uint256[] amounts)",
  "function splitPosition(bytes32 conditionId, uint256 amount)",
  "function mergePositions(bytes32 conditionId, uint256 amount)",
]);

export const ZERO_BYTES32 = `0x${"00".repeat(32)}`;

export const MAX_UINT256 = (1n << 256n) - 1n;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function decodeUint(hex: string): bigint {
  if (hex === "0x" || hex.length < 66)
    throw new Error(`empty call result: ${hex}`);
  return BigInt(hex.slice(0, 66));
}

export function decodeBool(hex: string): boolean {
  return decodeUint(hex) !== 0n;
}

export type UnwrapInitiated = {
  requestId: bigint;
  asset: string;
  usdwAmount: bigint;
  assetAmount: bigint;
  claimableAt: number;
};

/** 从回执日志里找出 wrapper 发出的 UnwrapInitiated；找不到返回 null，不猜。 */
export function findUnwrapInitiated(
  logs: { address: string; topics: string[]; data: string }[],
  wrapper: string,
): UnwrapInitiated | null {
  for (const log of logs) {
    if (getAddress(log.address) !== getAddress(wrapper)) continue;
    let parsed;
    try {
      parsed = usdWrapper.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      continue;
    }
    if (!parsed || parsed.name !== "UnwrapInitiated") continue;
    return {
      requestId: parsed.args.requestId as bigint,
      asset: getAddress(parsed.args.asset as string),
      usdwAmount: parsed.args.usdwAmount as bigint,
      assetAmount: parsed.args.assetAmount as bigint,
      claimableAt: Number(parsed.args.claimableAt as bigint),
    };
  }
  return null;
}
