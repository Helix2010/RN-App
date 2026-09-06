import { sub, type Money } from "../../../core/money/money";
import type { DisputeInput } from "./predict";

/** 与 gamma `service/dispute_evidence.go` 的常量一致：证据 150–1000 个字符（按码点）、链接 ≤5 条、https:// 且 ≤500 字符 */
export const DISPUTE_EVIDENCE_MIN = 150;
export const DISPUTE_EVIDENCE_MAX = 1000;
export const DISPUTE_MAX_LINKS = 5;
export const DISPUTE_LINK_MAX = 500;

export type DisputeValidation = {
  evidenceChars: number;
  evidenceError?: "tooShort" | "tooLong";
  /** 不合法链接的下标（按 normalize 之后的顺序） */
  invalidLinks: number[];
  tooManyLinks: boolean;
  ok: boolean;
};

/** 去掉首尾空白与空链接；提交与校验都用这份 */
export function normalizeDisputeInput(input: DisputeInput): DisputeInput {
  return {
    evidence: input.evidence.trim(),
    links: input.links.map((link) => link.trim()).filter(Boolean),
  };
}

export function validateDisputeInput(input: DisputeInput): DisputeValidation {
  const normalized = normalizeDisputeInput(input);
  const evidenceChars = Array.from(normalized.evidence).length;
  const evidenceError =
    evidenceChars < DISPUTE_EVIDENCE_MIN
      ? ("tooShort" as const)
      : evidenceChars > DISPUTE_EVIDENCE_MAX
        ? ("tooLong" as const)
        : undefined;
  const invalidLinks = normalized.links
    .map((link, index) =>
      link.startsWith("https://") && link.length <= DISPUTE_LINK_MAX
        ? -1
        : index,
    )
    .filter((index) => index >= 0);
  const tooManyLinks = normalized.links.length > DISPUTE_MAX_LINKS;
  return {
    evidenceChars,
    evidenceError,
    invalidLinks,
    tooManyLinks,
    ok: !evidenceError && invalidLinks.length === 0 && !tooManyLinks,
  };
}

export type DisputeFailure =
  | "window_closed"
  | "already_disputed"
  | "not_open"
  | "evidence_rejected"
  | "unknown_market"
  | "unsupported_adapter"
  | "no_dispute_key"
  | "reverted";

/** 争议流程里可预期的失败；`reason` 对应文案键 `predict.dispute.error.<reason>` */
export class PredictDisputeError extends Error {
  constructor(
    readonly reason: DisputeFailure,
    readonly detail = "",
  ) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "PredictDisputeError";
  }
}

/** 本地址 USDW 不够押金；`shortfall` 给"兑换 N USDC"按钮用 */
export class PredictInsufficientBondError extends Error {
  readonly shortfall: Money;

  constructor(
    readonly bond: Money,
    readonly balance: Money,
  ) {
    super(`dispute bond ${bond.raw} exceeds USDW balance ${balance.raw}`);
    this.name = "PredictInsufficientBondError";
    this.shortfall = sub(bond, balance);
  }
}
