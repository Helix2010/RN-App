import type { ChainId } from "../../../core/gateways/types";
import type { Session, WalletConnectorId } from "../model/session";

export type SignInRequest = {
  address: string;
  connector: WalletConnectorId;
  chains: ChainId[];
  /** 展示给用户的登录域名，进入 SIWE 消息 */
  domain: string;
};

export type SignInChallenge = {
  nonce: string;
  message: string;
  issuedAt: string;
  expiresAt: string;
};

export interface SessionGateway {
  get(): Promise<Session | null>;
  /** 生成 SIWE 风格挑战（一期本地；后续 RN-Server E7 提供 nonce） */
  challenge(request: SignInRequest): Promise<SignInChallenge>;
  /** 用钱包签名结果换会话 */
  verify(
    request: SignInRequest,
    challenge: SignInChallenge,
    signature: string,
  ): Promise<Session>;
  signOut(): Promise<void>;
  /**
   * 向服务端确认会话仍然有效。令牌被撤销或过期时返回 null，本地一并清除；
   * 只是网络不通时保留本地会话（离线可用）。Mock 实现不需要它。
   */
  refresh?(): Promise<Session | null>;
}
