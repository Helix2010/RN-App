import type { KeyValueStorage } from "../../../core/gateways/types";
import { mockNow, simulate } from "../../../core/mock/mock-runtime";
import type { Session } from "../model/session";
import type { SessionGateway, SignInChallenge, SignInRequest } from "./gateway";

const KEY = "foundation.session.v1";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export class MockSessionGateway implements SessionGateway {
  constructor(private readonly storage: KeyValueStorage) {}

  async get(): Promise<Session | null> {
    const raw = await this.storage.getItem(KEY);
    if (!raw) return null;
    try {
      const session = JSON.parse(raw) as Session;
      if (new Date(session.expiresAt).getTime() <= mockNow()) {
        await this.storage.removeItem(KEY);
        return null;
      }
      return session;
    } catch {
      await this.storage.removeItem(KEY);
      return null;
    }
  }

  async challenge(request: SignInRequest): Promise<SignInChallenge> {
    return simulate(() => {
      const issuedAt = new Date(mockNow()).toISOString();
      const expiresAt = new Date(mockNow() + SESSION_TTL_MS).toISOString();
      const nonce = Math.floor(Math.random() * 1e12).toString(36);
      const message = [
        `${request.domain} wants you to sign in with your Ethereum account:`,
        request.address,
        "",
        "Sign in to continue. This request will not trigger a blockchain transaction or cost any gas fees.",
        "",
        `URI: https://${request.domain}`,
        "Version: 1",
        `Chain ID: ${request.chains[0] === "bsc" ? 56 : request.chains[0] === "base" ? 8453 : 1}`,
        `Nonce: ${nonce}`,
        `Issued At: ${issuedAt}`,
        `Expiration Time: ${expiresAt}`,
      ].join("\n");
      return { nonce, message, issuedAt, expiresAt };
    });
  }

  async verify(
    request: SignInRequest,
    challenge: SignInChallenge,
    signature: string,
  ): Promise<Session> {
    return simulate(async () => {
      if (!signature.startsWith("0x") || signature.length < 10) {
        throw new Error("invalid signature");
      }
      const session: Session = {
        address: request.address,
        ens: request.address.toLowerCase().startsWith("0x3f4a")
          ? "kenneth.eth"
          : undefined,
        connector: request.connector,
        chains: request.chains,
        expiresAt: challenge.expiresAt,
        signedInAt: challenge.issuedAt,
      };
      await this.storage.setItem(KEY, JSON.stringify(session));
      return session;
    });
  }

  async signOut(): Promise<void> {
    await this.storage.removeItem(KEY);
  }
}
