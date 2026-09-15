import { AppError } from "../../../core/network/app-error";
import type {
  ReferralGateway,
  ReferralInvitee,
  ReferralInviteePage,
  ReferralInviter,
  ReferralOverview,
  ReferralSource,
} from "./gateway";

/**
 * 拒绝的形态也要和服务端一致：带 `code` 的 AppError。
 *
 * 抛裸 Error 的话 `referralErrorMessageKey` 认不出错误码，Mock 下每一种失败
 * 都落到通用文案——"服务端拒绝时显示对应原因"这类用例看着绿，实际什么都没验到。
 */
function referralError(code: string): AppError {
  return new AppError("server", code, false, undefined, 422, { code });
}

/**
 * 内存版邀请关系网关，只服务测试基座。
 *
 * 它按服务端的真实规则回答，而不是"总是成功"：绑定一次性、自己的码拒绝、
 * 窗口关闭后拒绝，**失败的形态也一样**。测试要能覆盖这些分支，
 * Mock 就不能比服务端宽松。
 */
export class MockReferralGateway implements ReferralGateway {
  private inviter: ReferralInviter | null = null;
  private readonly inviteeRows: ReferralInvitee[] = [];

  constructor(
    private readonly options: {
      inviteCode?: string;
      inviteLink?: string;
      /** 已知有效的邀请码；不在表里的一律视作无效 */
      validCodes?: string[];
      windowOpen?: boolean;
      /** 每页条数，测翻页用 */
      pageSize?: number;
      closesAt?: string;
    } = {},
  ) {}

  async overview(): Promise<ReferralOverview> {
    const inviteCode = this.options.inviteCode ?? "ABCD1234";
    return {
      inviteCode,
      inviteLink:
        this.options.inviteLink ??
        `https://api.example.com/app/invite/${inviteCode}`,
      inviter: this.inviter,
      bindWindow: {
        open: this.inviter === null && (this.options.windowOpen ?? true),
        closesAt: this.options.closesAt ?? "2026-09-22T00:00:00.000Z",
      },
      inviteeCount: this.inviteeRows.length,
    };
  }

  async bind(code: string, _source: ReferralSource): Promise<ReferralInviter> {
    void _source;
    if (this.inviter) throw referralError("REFERRAL_ALREADY_BOUND");
    if (!(this.options.windowOpen ?? true))
      throw referralError("REFERRAL_WINDOW_CLOSED");
    const normalized = code.trim().toUpperCase();
    if (normalized === (this.options.inviteCode ?? "ABCD1234"))
      throw referralError("REFERRAL_SELF");
    const valid = this.options.validCodes ?? ["ZZZZ9999"];
    if (!valid.includes(normalized))
      throw referralError("REFERRAL_CODE_UNKNOWN");
    this.inviter = {
      inviteCode: normalized,
      boundAt: "2026-09-15T02:00:00.000Z",
    };
    return this.inviter;
  }

  /**
   * 键集分页。每页 `pageSize` 条，游标是下一条的下标。
   * Mock 必须真的翻页，否则"加载更多其实在重拉第一页"这类缺陷测不出来。
   */
  async invitees(cursor?: string): Promise<ReferralInviteePage> {
    const pageSize = this.options.pageSize ?? 20;
    const start = cursor ? Number(cursor) : 0;
    const items = this.inviteeRows.slice(start, start + pageSize);
    const next = start + pageSize;
    const hasMore = next < this.inviteeRows.length;
    return {
      items,
      total: this.inviteeRows.length,
      nextCursor: hasMore ? String(next) : null,
      hasMore,
    };
  }

  /** 测试用：预置几条下级 */
  seedInvitees(items: ReferralInvitee[]): void {
    this.inviteeRows.splice(0, this.inviteeRows.length, ...items);
  }
}
