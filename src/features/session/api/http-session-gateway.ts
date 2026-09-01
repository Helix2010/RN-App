import * as SecureStore from "expo-secure-store";
import { z } from "zod";
import type { KeyValueStorage } from "../../../core/gateways/types";
import { apiClient } from "../../../core/network/api-client";
import { AppError } from "../../../core/network/app-error";
import type { Session } from "../model/session";
import type { SessionGateway, SignInChallenge, SignInRequest } from "./gateway";

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
    const response = await apiClient.post(
      "/v1/mobile/auth/verify",
      {
        address: request.address,
        nonce: challenge.nonce,
        signature,
        connector: request.connector,
        chains: request.chains,
      },
      verifySchema,
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
      const session: Session = {
        ...cached,
        address: remote.address,
        expiresAt: remote.expiresAt,
      };
      await this.storage.setItem(SESSION_KEY, JSON.stringify(session));
      return session;
    } catch (error) {
      if (error instanceof AppError && error.status === 401) {
        await this.clear();
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
