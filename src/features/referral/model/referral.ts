import { AppError } from "../../../core/network/app-error";

/**
 * 展示用的分段形态 `XXXX-XXXX`，提高抄写正确率（设计 §5.1）。
 *
 * 存储、URL 与二维码内容一律用不分段的原值；服务端归一化会去掉连字符，
 * 所以用户把分段形态粘回输入框也认。长度不对就原样返回，不去猜怎么分段。
 */
export function formatInviteCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/**
 * 把服务端的错误码映射成文案键。
 *
 * 逐个列出而不是拼字符串：文案键要能被 `pnpm i18n:check` 静态扫到，
 * 动态拼出来的键漏翻译时没人会发现。
 */
const MESSAGE_BY_CODE: Record<string, string> = {
  REFERRAL_CODE_MALFORMED: "referral.error.malformed",
  REFERRAL_CODE_UNKNOWN: "referral.error.unknown",
  REFERRAL_ALREADY_BOUND: "referral.error.alreadyBound",
  REFERRAL_SELF: "referral.error.self",
  REFERRAL_CYCLE: "referral.error.cycle",
  REFERRAL_INVITER_BLOCKED: "referral.error.inviterBlocked",
  REFERRAL_WINDOW_CLOSED: "referral.windowClosed",
  REFERRAL_DISABLED: "referral.disabled",
  REFERRAL_BIND_BUSY: "referral.error.busy",
  REFERRAL_RATE_LIMITED: "referral.error.rateLimited",
};

/**
 * 认不出来的错误走通用文案，但**不吞**：调用方照样把它显示出来。
 * 这里不猜服务端的意图，只负责给用户一句能看懂的话。
 */
export function referralErrorMessageKey(error: unknown): string {
  if (error instanceof AppError && error.code) {
    const key = MESSAGE_BY_CODE[error.code];
    if (key) return key;
  }
  return "state.error";
}
