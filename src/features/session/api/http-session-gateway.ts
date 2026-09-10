import * as SecureStore from "expo-secure-store";
import { z } from "zod";
import type { KeyValueStorage } from "../../../core/gateways/types";
import {
  ensureInstallationAuthorization,
  forgetInstallationCredential,
} from "../../../core/device/installation-service";
import { notifySessionStateChanged } from "../../../core/device/session-state-probe";
import { apiClient } from "../../../core/network/api-client";
import { AppError } from "../../../core/network/app-error";
import type { Session } from "../model/session";
import type { SessionGateway, SignInChallenge, SignInRequest } from "./gateway";

/** 地址比较只看大小写无关的十六进制：服务端可能回 EIP-55，也可能回全小写。 */
function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

const SESSION_KEY = "foundation.session.v1";
const TOKEN_KEY = "foundation.session-token.v1";

const challengeSchema = z.object({
  nonce: z.string(),
  message: z.string(),
  issuedAt: z.string(),
  expiresAt: z.string(),
});

const verifySchema = z.object({
  address: z.string(),
  connector: z.string(),
  chains: z.array(z.string()),
  sessionToken: z.string(),
  signedInAt: z.string(),
  expiresAt: z.string(),
  registered: z.boolean(),
});

const sessionSchema = z.object({
  address: z.string(),
  connector: z.string(),
  chains: z.array(z.string()),
  expiresAt: z.string(),
});

/**
 * 真实的钱包会话：挑战由 RN-Server 构造（nonce 服务端持有并一次性核销），
 * 签名换来的会话令牌存系统安全存储，会话本身缓存在普通存储里供离线读取。
 *
 * 客户端**不**自己拼 SIWE 消息 —— 服务端下发整条消息，避免两边拼接不一致，
 * 也避免客户端自己编造 domain 或有效期。
 */
export class HttpSessionGateway implements SessionGateway {
  constructor(private readonly storage: KeyValueStorage) {}

  async get(): Promise<Session | null> {
    const cached = await this.readCached();
    if (!cached) return null;
    if (new Date(cached.expiresAt).getTime() <= Date.now()) {
      await this.clear();
      return null;
    }
    return cached;
  }

  /** 拿服务端签发的挑战；`request.domain` 由服务端按请求域名决定，这里只做展示。 */
  async challenge(request: SignInRequest): Promise<SignInChallenge> {
    const response = await apiClient.post(
      "/v1/mobile/auth/nonce",
      { address: request.address, chains: request.chains },
      challengeSchema,
    );
    return response;
  }

  async verify(
    request: SignInRequest,
    challenge: SignInChallenge,
    signature: string,
  ): Promise<Session> {
    const body = {
      address: request.address,
      nonce: challenge.nonce,
      signature,
      connector: request.connector,
      chains: request.chains,
    };
    // 登录必须带安装身份（设计 §4.2）：服务端把会话关联到这台安装，定向推送与
    // 管理端"当前账号"都靠它。凭证缺失就当场注册；注册不了登录失败并给明确原因
    let installation = await ensureInstallationAuthorization();
    let response: z.infer<typeof verifySchema>;
    try {
      response = await apiClient.post(
        "/v1/mobile/auth/verify",
        body,
        verifySchema,
        { headers: installation },
      );
    } catch (error) {
      // 凭证被撤销 / 轮换了：丢掉后重新注册，用同一挑战重试一次
      //（服务端在核销 nonce 之前校验）；再失败就让错误原样浮上去
      if (
        !(error instanceof AppError) ||
        error.status !== 401 ||
        error.code !== "INSTALLATION_CREDENTIAL_INVALID"
      )
        throw error;
      await forgetInstallationCredential();
      installation = await ensureInstallationAuthorization();
      response = await apiClient.post(
        "/v1/mobile/auth/verify",
        body,
        verifySchema,
        { headers: installation },
      );
    }
    // 签的是哪个账户，会话就必须是哪个账户。服务端返回别的地址时不能照单全收：
    // 后续所有余额、下单、签名都会打到这个地址上（安全评审 N26）。
    if (!sameAddress(response.address, request.address))
      throw new AppError(
        "incompatible_response",
        `sign-in returned ${response.address}, expected ${request.address}`,
        false,
      );
    const session: Session = {
      address: response.address,
      connector: request.connector,
      chains: request.chains,
      expiresAt: response.expiresAt,
      signedInAt: response.signedInAt,
    };
    await SecureStore.setItemAsync(TOKEN_KEY, response.sessionToken, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    await this.storage.setItem(SESSION_KEY, JSON.stringify(session));
    notifySessionStateChanged();
    return session;
  }

  async signOut(): Promise<void> {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (token) {
      try {
        await apiClient.post(
          "/v1/mobile/auth/logout",
          {},
          z.object({ signedOut: z.literal(true), revokedAt: z.string() }),
          { headers: { Authorization: `Wallet ${token}` } },
        );
      } catch (error) {
        // 服务端撤销失败不能把用户卡在登录态：本地照样清干净
        if (!(error instanceof AppError)) throw error;
      }
    }
    await this.clear();
    notifySessionStateChanged();
  }

  /** 让服务端确认会话仍然有效；令牌被撤销或过期时本地一并清除。 */
  async refresh(): Promise<Session | null> {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    const cached = await this.readCached();
    if (!token || !cached) {
      await this.clear();
      return null;
    }
    try {
      const remote = await apiClient.get(
        "/v1/mobile/auth/session",
        sessionSchema,
        { headers: { Authorization: `Wallet ${token}` } },
      );
      // 令牌对应的账户与本地记录不一致：这不是"地址变了"，而是这份令牌根本
      // 不属于本地这个会话。改写本地地址会让界面把别人的账户当成自己的，
      // 一律按会话失效处理（安全评审 N26）。
      if (!sameAddress(remote.address, cached.address)) {
        await this.clear();
        notifySessionStateChanged();
        return null;
      }
      const session: Session = {
        ...cached,
        expiresAt: remote.expiresAt,
      };
      await this.storage.setItem(SESSION_KEY, JSON.stringify(session));
      return session;
    } catch (error) {
      if (error instanceof AppError && error.status === 401) {
        await this.clear();
        notifySessionStateChanged();
        return null;
      }
      // 网络问题不代表会话失效，保留本地会话
      return cached;
    }
  }

  /** 供业务请求带上会话令牌。 */
  async authorization(): Promise<Record<string, string>> {
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    return token ? { Authorization: `Wallet ${token}` } : {};
  }

  private async readCached(): Promise<Session | null> {
    const raw = await this.storage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Session;
    } catch {
      await this.storage.removeItem(SESSION_KEY);
      return null;
    }
  }

  private async clear(): Promise<void> {
    await this.storage.removeItem(SESSION_KEY);
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}
