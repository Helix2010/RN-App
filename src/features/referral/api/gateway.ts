/**
 * 邀请关系网关（设计 referral-graph-2026-09-15 §4.2）。
 *
 * 一期只有关系，没有返佣，所以这里没有任何金额字段。
 *
 * 另一条贯穿的规则：**服务端不返回任何地址派生值**。邀请人用邀请码表示，
 * 下级用 per-viewer 别名——"脱敏地址"前 6 后 4 是 32 bit，对现实候选集
 * 等同唯一键，拿去公链索引器一查就还原出完整地址。
 */

/** 绑定渠道。由提交路径决定，只用于运营统计，不参与判定。admin 只能由管理端写入。 */
export type ReferralSource = "code" | "link";

export type ReferralInviter = {
  /** 绑定时用的那个邀请码。不含地址 */
  inviteCode: string;
  boundAt: string;
};

export type ReferralOverview = {
  inviteCode: string;
  /** 服务端拼好的完整邀请链接，客户端不自己拼 */
  inviteLink: string;
  inviter: ReferralInviter | null;
  bindWindow: {
    /** 尚未绑定且仍在窗口内 */
    open: boolean;
    closesAt: string;
  };
  inviteeCount: number;
};

export type ReferralInvitee = {
  /** per-viewer 别名，不是地址派生值 */
  alias: string;
  joinedAt: string;
};

export type ReferralInviteePage = {
  items: ReferralInvitee[];
  total: number;
  nextCursor: string | null;
  hasMore: boolean;
};

export interface ReferralGateway {
  /** 我的邀请码、我的邀请人、下级数与绑定窗口 */
  overview(): Promise<ReferralOverview>;
  /**
   * 绑定邀请人。一次性、不可解除。
   *
   * `code` 传用户输入的**原文**：归一化只在服务端做，客户端各自 trim 就是第二份真相。
   */
  bind(code: string, source: ReferralSource): Promise<ReferralInviter>;
  /** 我的直接下级，键集分页 */
  invitees(cursor?: string): Promise<ReferralInviteePage>;
}

/*
 * 这里**没有** checkCode（免登录的 GET /v1/mobile/referral/codes/:code）。
 * 接口在服务端是有的，落地页用它；App 侧一期不预校验：确认层只问"要不要绑"，
 * 绑不绑得成由 bind 回答。预校验返回一个 boolean 会把设计 §4.1 特意分开的
 * 条件 2（码输错了，提示重输）与条件 3（码无效，提示向邀请人核对）合并成一句
 * 含糊的话，那正是设计不要的。将来真要接，返回值得能区分这两种。
 */
