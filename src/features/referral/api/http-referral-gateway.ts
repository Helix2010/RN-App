import { z } from "zod";
import { apiClient } from "../../../core/network/api-client";
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

/** 真实的邀请关系接口。三个方法都要会话令牌。 */
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
}
