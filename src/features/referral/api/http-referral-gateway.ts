import { z } from "zod";
import { apiClient } from "../../../core/network/api-client";
import { AppError } from "../../../core/network/app-error";
import type {
  ReferralGateway,
  ReferralInviteePage,
  ReferralInviter,
  ReferralOverview,
  ReferralSource,
} from "./gateway";

const inviterSchema = z.object({
  inviteCode: z.string().min(1),
  boundAt: z.string().min(1),
});

const overviewSchema = z.object({
  inviteCode: z.string().min(1),
  inviteLink: z.string().url(),
  inviter: inviterSchema.nullable(),
  bindWindow: z.object({
    open: z.boolean(),
    closesAt: z.string().min(1),
  }),
  inviteeCount: z.number().int().nonnegative(),
});

const inviteesSchema = z.object({
  items: z.array(
    z.object({ alias: z.string().min(1), joinedAt: z.string().min(1) }),
  ),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

const bindSchema = z.object({
  inviter: inviterSchema,
  boundAt: z.string().min(1),
});

const codeSchema = z.object({ valid: z.boolean() });

/**
 * 真实的邀请关系接口。
 *
 * 除 `checkCode` 外都要会话令牌：`checkCode` 免登录，因为"这个码有效吗"这件事
 * 发生在用户登录之前（深链落地、绑定前确认）。
 */
export class HttpReferralGateway implements ReferralGateway {
  constructor(
    private readonly deps: {
      session: { authorization(): Promise<Record<string, string>> };
    },
  ) {}

  async overview(): Promise<ReferralOverview> {
    return apiClient.get("/v1/mobile/referral/me", overviewSchema, {
      headers: await this.deps.session.authorization(),
    });
  }

  async bind(code: string, source: ReferralSource): Promise<ReferralInviter> {
    // code 传原文，归一化在服务端一处做
    const response = await apiClient.post(
      "/v1/mobile/referral/bind",
      { code, source },
      bindSchema,
      { headers: await this.deps.session.authorization() },
    );
    return response.inviter;
  }

  async invitees(cursor?: string): Promise<ReferralInviteePage> {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return apiClient.get(
      `/v1/mobile/referral/invitees${query}`,
      inviteesSchema,
      { headers: await this.deps.session.authorization() },
    );
  }

  async checkCode(code: string): Promise<boolean> {
    try {
      const response = await apiClient.get(
        `/v1/mobile/referral/codes/${encodeURIComponent(code)}`,
        codeSchema,
      );
      return response.valid;
    } catch (error) {
      // 404 / 422 是"这个码不能用"，是正常答案而不是故障；其余照抛，
      // 免得把网络错误说成"邀请码无效"让用户白白重输
      if (
        error instanceof AppError &&
        (error.status === 404 || error.status === 422)
      ) {
        return false;
      }
      throw error;
    }
  }
}
