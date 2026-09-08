import { z } from "zod";
import type { PredictServiceConfig } from "../config/bootstrap.schema";
import {
  PlatformHttpError,
  platformHosts,
  platformRequest,
} from "./tenant-client";

/**
 * 预测平台的用户资料（gamma-service `Profile`）。
 * - 读自己的资料走 `GET /profiles/user_address/{address}`：完整资料且没有缓存头；
 *   `GET /public-profile` 被服务端 `Cache-Control: max-age=3600`，改完昵称会读到旧值（网页版就是这样）。
 * - 改资料走 `POST /profiles`，`Authorization: Bearer <gamma jwt>`，body 只带要改的字段（缺省 = 不改）。
 */
const profileSchema = z.object({
  name: z.string().nullish(),
  pseudonym: z.string().nullish(),
  displayUsernamePublic: z.boolean().nullish(),
  bio: z.string().nullish(),
  profileImage: z.string().nullish(),
  xUsername: z.string().nullish(),
});
export type PlatformProfile = z.infer<typeof profileSchema>;

/** 昵称规则与网页版 `WalletButton` 一致：去首尾空白，最长 32 字符；空串 = 清除 */
export const NICKNAME_MAX_LENGTH = 32;

export class ProfileNameTooLongError extends Error {
  constructor() {
    super(`nickname must be at most ${NICKNAME_MAX_LENGTH} characters`);
    this.name = "ProfileNameTooLongError";
  }
}

/**
 * 按地址读资料。平台对从未登录过的地址回 404（`{"code":40400}`）：这是"还没有资料"，返回 null；
 * 其它错误照常抛出。
 */
export async function fetchProfile(
  service: PredictServiceConfig,
  address: string,
): Promise<PlatformProfile | null> {
  const hosts = platformHosts(service);
  try {
    return await platformRequest({
      url: `${hosts.gamma}/profiles/user_address/${encodeURIComponent(address.toLowerCase())}`,
      tenantDomain: service.domain,
      schema: profileSchema,
    });
  } catch (error) {
    if (error instanceof PlatformHttpError && error.status === 404) return null;
    throw error;
  }
}

export async function updateProfile(
  service: PredictServiceConfig,
  token: string,
  patch: { name: string },
): Promise<PlatformProfile> {
  const name = patch.name.trim();
  if (name.length > NICKNAME_MAX_LENGTH) throw new ProfileNameTooLongError();
  const hosts = platformHosts(service);
  return platformRequest({
    url: `${hosts.gamma}/profiles`,
    tenantDomain: service.domain,
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: { name },
    schema: profileSchema,
  });
}
