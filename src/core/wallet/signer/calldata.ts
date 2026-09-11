import { Interface, getAddress } from "ethers";

/**
 * 交易 calldata 的语义解码（安全评审 N22）。
 *
 * 守卫此前只看 chainId / to / 手续费，对 `data` 里写着什么一无所知——也就是说
 * "把全部余额的支配权交给某个地址"和"转 1 块钱"在签名前长得一模一样。要让确认
 * 界面说得出"你正在授权谁"、要让策略认得出哪些调用值得多问一句，第一步是把
 * 这几个标准选择器解出来。
 *
 * 只认标准 ERC-20 / ERC-721 的授权与转账选择器。**认不出来不等于安全**，只等于
 * "这里给不出解释"——返回 `null`，由调用方决定怎么呈现。真实资金档"未知 calldata
 * 一律拒绝"是评审 §12.2 的门禁，但那会改变现有流程的可用性，属待决策项，不在这里。
 */

const ERC20_MAX = (1n << 256n) - 1n;
/** 有些前端用 2^255-1 当"无限"，链上效果与 2^256-1 一样是"多到用不完" */
const UNLIMITED_FLOOR = (1n << 255n) - 1n;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const abi = new Interface([
  "function approve(address spender, uint256 value)",
  "function setApprovalForAll(address operator, bool approved)",
  "function increaseAllowance(address spender, uint256 addedValue)",
  "function transfer(address to, uint256 value)",
  "function transferFrom(address from, address to, uint256 value)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
]);

export type CalldataIntent =
  | {
      kind: "approve" | "increaseAllowance" | "permit";
      /** 拿到支配权的地址——确认界面必须显示的就是它 */
      spender: string;
      amount: bigint;
      /** 授权额度大到实际等于"全部且永久" */
      unlimited: boolean;
    }
  | {
      kind: "setApprovalForAll";
      /** 整个 NFT 集合的操作者；`approved=false` 是撤销 */
      spender: string;
      approved: boolean;
    }
  | { kind: "transfer"; recipient: string; amount: bigint }
  | { kind: "transferFrom"; from: string; recipient: string; amount: bigint };

/** 额度是否等于"无限"。`increaseAllowance` 用同一把尺子衡量增量。 */
export function isUnlimitedAllowance(amount: bigint): boolean {
  return amount >= UNLIMITED_FLOOR;
}

/** 供 UI 与测试：标准的"无限授权"额度。 */
export const UNLIMITED_ALLOWANCE = ERC20_MAX;

/**
 * 解出这段 calldata 在做什么；认不出返回 `null`。
 *
 * 解析失败（长度不对、参数编码坏了）同样返回 `null`：解码只用于解释和加固，
 * 不能因为解不开就把一笔合法交易拦下来——那会把"看不懂"变成拒绝服务。
 */
export function describeCalldata(
  data: string | undefined,
): CalldataIntent | null {
  if (!data || data === "0x") return null;
  let parsed;
  try {
    parsed = abi.parseTransaction({ data });
  } catch {
    return null;
  }
  if (!parsed) return null;
  const args = parsed.args;
  try {
    switch (parsed.name) {
      case "approve":
      case "increaseAllowance": {
        const amount = BigInt(args[1] as bigint);
        return {
          kind: parsed.name,
          spender: getAddress(args[0] as string),
          amount,
          unlimited: isUnlimitedAllowance(amount),
        };
      }
      case "permit": {
        const amount = BigInt(args[2] as bigint);
        return {
          kind: "permit",
          spender: getAddress(args[1] as string),
          amount,
          unlimited: isUnlimitedAllowance(amount),
        };
      }
      case "setApprovalForAll":
        return {
          kind: "setApprovalForAll",
          spender: getAddress(args[0] as string),
          approved: Boolean(args[1]),
        };
      case "transfer":
        return {
          kind: "transfer",
          recipient: getAddress(args[0] as string),
          amount: BigInt(args[1] as bigint),
        };
      case "transferFrom":
        return {
          kind: "transferFrom",
          from: getAddress(args[0] as string),
          recipient: getAddress(args[1] as string),
          amount: BigInt(args[2] as bigint),
        };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** 这笔调用是否在把支配权交出去（确认界面要按"授权"而不是"转账"来呈现）。 */
export function grantsAllowance(intent: CalldataIntent | null): boolean {
  if (!intent) return false;
  if (intent.kind === "setApprovalForAll") return intent.approved;
  return (
    intent.kind === "approve" ||
    intent.kind === "increaseAllowance" ||
    intent.kind === "permit"
  );
}

/**
 * 解出来之后一眼可知是错的那些组合。返回 `null` 表示没看出问题。
 *
 * 只列"任何正常流程都不会产生、且后果不可逆"的情况，不做策略判断：
 * 把额度授权给零地址不是撤销（撤销是把额度设成 0），转账到零地址是销毁。
 * 这两种都是参数拼错或被改过，签下去救不回来。
 */
export function impossibleIntentReason(
  intent: CalldataIntent | null,
): string | null {
  if (!intent) return null;
  const zero = (address: string): boolean =>
    address.toLowerCase() === ZERO_ADDRESS;
  if (intent.kind === "transfer" || intent.kind === "transferFrom")
    return zero(intent.recipient) ? "转账目标是零地址，代币会被销毁" : null;
  if (intent.kind === "setApprovalForAll")
    return intent.approved && zero(intent.spender)
      ? "把整个集合授权给零地址"
      : null;
  return zero(intent.spender) && intent.amount > 0n
    ? "把额度授权给零地址（撤销应当是把额度设为 0）"
    : null;
}
