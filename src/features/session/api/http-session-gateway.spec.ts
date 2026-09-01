import { memoryStorage } from "../../../core/gateways/types";
import { apiClient } from "../../../core/network/api-client";
import { AppError } from "../../../core/network/app-error";
import { HttpSessionGateway } from "./http-session-gateway";
import type { SignInRequest } from "./gateway";

const mockSecure = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "afterFirstUnlockThisDeviceOnly",
  getItemAsync: jest.fn(async (key: string) => mockSecure.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecure.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecure.delete(key);
  }),
}));
jest.mock("../../../core/network/api-client", () => ({
  apiClient: { post: jest.fn(), get: jest.fn() },
  appRuntime: { apiBaseUrl: "https://api.example.com" },
}));

const post = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const get = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

const request: SignInRequest = {
  address: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
  connector: "embedded",
  chains: ["bsc"],
  domain: "api.example.com",
};
const challenge = {
  nonce: "server-nonce",
  message: "api.example.com wants you to sign in…",
  issuedAt: "2026-09-01T00:00:00.000Z",
  expiresAt: "2026-09-01T00:10:00.000Z",
};

function setup() {
  mockSecure.clear();
  post.mockReset();
  get.mockReset();
  return new HttpSessionGateway(memoryStorage());
}

function verifyResponse(overrides?: Record<string, unknown>) {
  return {
    address: request.address,
    connector: "embedded",
    chains: ["bsc"],
    sessionToken: "wtok_test",
    signedInAt: "2026-09-01T00:01:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    registered: true,
    ...overrides,
  };
}

describe("HttpSessionGateway", () => {
  it("takes the challenge from the server rather than building one", async () => {
    const gateway = setup();
    post.mockResolvedValueOnce(challenge);
    await expect(gateway.challenge(request)).resolves.toEqual(challenge);
    expect(post).toHaveBeenCalledWith(
      "/v1/mobile/auth/nonce",
      { address: request.address, chains: ["bsc"] },
      expect.anything(),
    );
  });

  it("exchanges a signature for a session and keeps the token in secure storage", async () => {
    const gateway = setup();
    post.mockResolvedValueOnce(verifyResponse());
    const session = await gateway.verify(request, challenge, "0xsig");
    expect(session).toMatchObject({
      address: request.address,
      connector: "embedded",
      chains: ["bsc"],
    });
    expect(post).toHaveBeenCalledWith(
      "/v1/mobile/auth/verify",
      expect.objectContaining({ nonce: "server-nonce", signature: "0xsig" }),
      expect.anything(),
    );
    // 令牌进安全存储，不进普通存储
    expect(mockSecure.get("foundation.session-token.v1")).toBe("wtok_test");
    await expect(gateway.get()).resolves.toMatchObject({
      address: request.address,
    });
    await expect(gateway.authorization()).resolves.toEqual({
      Authorization: "Wallet wtok_test",
    });
  });

  it("drops an expired cached session", async () => {
    const gateway = setup();
    post.mockResolvedValueOnce(
      verifyResponse({ expiresAt: "2000-01-01T00:00:00.000Z" }),
    );
    await gateway.verify(request, challenge, "0xsig");
    await expect(gateway.get()).resolves.toBeNull();
    expect(mockSecure.has("foundation.session-token.v1")).toBe(false);
  });

  it("revokes the session server-side on sign-out", async () => {
    const gateway = setup();
    post.mockResolvedValueOnce(verifyResponse());
    await gateway.verify(request, challenge, "0xsig");
    post.mockResolvedValueOnce({
      signedOut: true,
      revokedAt: "2026-09-01T00:02:00.000Z",
    });
    await gateway.signOut();
    expect(post).toHaveBeenLastCalledWith(
      "/v1/mobile/auth/logout",
      {},
      expect.anything(),
      { headers: { Authorization: "Wallet wtok_test" } },
    );
    await expect(gateway.get()).resolves.toBeNull();
  });

  it("still signs out locally when the server call fails", async () => {
    const gateway = setup();
    post.mockResolvedValueOnce(verifyResponse());
    await gateway.verify(request, challenge, "0xsig");
    post.mockRejectedValueOnce(new AppError("network", "offline", true));
    await gateway.signOut();
    await expect(gateway.get()).resolves.toBeNull();
    expect(mockSecure.has("foundation.session-token.v1")).toBe(false);
  });

  it("clears the session when the server says the token is gone", async () => {
    const gateway = setup();
    post.mockResolvedValueOnce(verifyResponse());
    await gateway.verify(request, challenge, "0xsig");
    get.mockRejectedValueOnce(
      new AppError("server", "unauthorized", false, undefined, 401),
    );
    await expect(gateway.refresh()).resolves.toBeNull();
    await expect(gateway.get()).resolves.toBeNull();
  });

  it("keeps the session when refresh fails for network reasons", async () => {
    const gateway = setup();
    post.mockResolvedValueOnce(verifyResponse());
    await gateway.verify(request, challenge, "0xsig");
    get.mockRejectedValueOnce(new AppError("network", "offline", true));
    await expect(gateway.refresh()).resolves.toMatchObject({
      address: request.address,
    });
  });
});
