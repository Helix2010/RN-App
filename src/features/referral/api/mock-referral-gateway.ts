import type {
  ReferralGateway,
  ReferralInviteePage,
  ReferralInviter,
  ReferralOverview,
  ReferralSource,
} from "./gateway";

/**
 * 内存版邀请关系网关，只服务测试基座。
 *
 * 它按服务端的真实规则回答，而不是"总是成功"：绑定一次性、自己的码拒绝、
 * 窗口关闭后拒绝。测试要能覆盖这些分支，Mock 就不能比服务端宽松。
 */
export class MockReferralGateway implements ReferralGateway {
  private inviter: ReferralInviter | null = null;
  private readonly inviteeRows: ReferralInviteePage["items"] = [];

  constructor(
    private readonly options: {
      inviteCode?: string;
      inviteLink?: string;
      /** 已知有效的邀请码；不在表里的一律视作无效 */
      validCodes?: string[];
      windowOpen?: boolean;
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
    if (this.inviter) throw new Error("REFERRAL_ALREADY_BOUND");
    if (!(this.options.windowOpen ?? true))
      throw new Error("REFERRAL_WINDOW_CLOSED");
    const normalized = code.trim().toUpperCase();
    if (normalized === (this.options.inviteCode ?? "ABCD1234"))
      throw new Error("REFERRAL_SELF");
    if (!(await this.checkCode(normalized)))
      throw new Error("REFERRAL_CODE_UNKNOWN");
    this.inviter = {
      inviteCode: normalized,
      boundAt: "2026-09-15T02:00:00.000Z",
    };
    return this.inviter;
  }

  async invitees(cursor?: string): Promise<ReferralInviteePage> {
    void cursor;
    return {
      items: this.inviteeRows,
      total: this.inviteeRows.length,
      nextCursor: null,
      hasMore: false,
    };
  }

  async checkCode(code: string): Promise<boolean> {
    const codes = this.options.validCodes ?? ["ZZZZ9999"];
    return codes.includes(code.trim().toUpperCase());
  }

  /** 测试用：预置几条下级 */
  seedInvitees(items: ReferralInviteePage["items"]): void {
    this.inviteeRows.splice(0, this.inviteeRows.length, ...items);
  }
}
