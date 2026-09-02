import { Wallet, verifyTypedData } from "ethers";
import { decodeJwt, jwtUsable, loginTypedData, loginWithSigner } from "./auth";
import { setPlatformFetch } from "./tenant-client";
import type { WalletSigner } from "../wallet/signer/types";

const SCOPE =
  "0xfb05e4134e5b30db022b94b822e7d19b1e5cd1c244468eada63789fd3514454a";

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payload)}.sig`;
}

describe("loginTypedData", () => {
  it("signs LoginMessage with scopeId as uint256 and no verifyingContract", async () => {
    const wallet = Wallet.createRandom();
    const typed = loginTypedData({
      address: wallet.address.toLowerCase(),
      nonce: "73ddbcae74d82e87f8a26cab",
      scopeId: SCOPE,
      issuedAt: "2026-09-02T12:22:49Z",
      domain: "predict.prax1s.xyz",
      uri: "https://predict.prax1s.xyz",
      chainId: 11155420,
    });
    const signature = await wallet.signTypedData(
      typed.domain,
      typed.types,
      typed.value,
    );
    expect(
      verifyTypedData(typed.domain, typed.types, typed.value, signature),
    ).toBe(wallet.address);
    expect(typed.value.scopeId).toBe(BigInt(SCOPE));
    expect(typed.domain).toEqual({
      name: "PredictMarket",
      version: "1",
      chainId: 11155420,
    });
  });
});

describe("jwtUsable", () => {
  const address = "0xB38b3E94803B22fAcb0Bb488192EAf2032dffC7c";
  const claims = {
    sub: address.toLowerCase(),
    scope_id: SCOPE,
    iat: 1000,
    exp: 5000,
  };

  it("accepts a token for this address and scope with margin left", () => {
    expect(jwtUsable(jwt(claims), address, SCOPE, 4000)).toBe(true);
  });

  it("rejects another address, another scope, or a token about to expire", () => {
    expect(
      jwtUsable(jwt(claims), Wallet.createRandom().address, SCOPE, 4000),
    ).toBe(false);
    expect(
      jwtUsable(
        jwt({ ...claims, scope_id: "0x" + "ab".repeat(32) }),
        address,
        SCOPE,
        4000,
      ),
    ).toBe(false);
    // 还剩 200 秒，低于 300 秒余量：要先刷新
    expect(jwtUsable(jwt(claims), address, SCOPE, 4800)).toBe(false);
  });

  it("decodes only well-formed payloads", () => {
    expect(decodeJwt("not.a.jwt")).toBeNull();
    expect(decodeJwt(jwt({ sub: 1 }))).toBeNull();
  });
});

describe("loginWithSigner", () => {
  afterEach(() => setPlatformFetch(null));

  it("fetches a fresh nonce and signs again once when gamma answers 40101", async () => {
    const wallet = Wallet.createRandom();
    const signer: WalletSigner = {
      address: wallet.address,
      managesOwnFees: false,
      signMessage: (message) => wallet.signMessage(message),
      signTypedData: (domain, types, value) =>
        wallet.signTypedData(domain, types, value),
      submitTransaction: async () => {
        throw new Error("not used");
      },
    };
    const calls: string[] = [];
    let nonces = 0;
    let logins = 0;
    setPlatformFetch(async (input) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      if (url.pathname === "/auth/nonce") {
        nonces += 1;
        return json(200, {
          nonce: `nonce-${nonces}`,
          scopeId: SCOPE,
          issuedAt: "2026-09-02T12:22:49Z",
          chainId: 11155420,
          statement: "Sign in",
        });
      }
      logins += 1;
      // 第一次：nonce 已核销；第二次成功
      return logins === 1
        ? json(401, { code: 40101, message: "invalid or expired nonce" })
        : json(200, { token: "jwt" });
    });
    await expect(
      loginWithSigner(
        { domain: "predict.prax1s.xyz", scopeId: SCOPE, chain: "op-sepolia" },
        signer,
        { reason: "test" },
      ),
    ).resolves.toBe("jwt");
    expect(calls).toEqual([
      "/auth/nonce",
      "/auth/login",
      "/auth/nonce",
      "/auth/login",
    ]);
  });

  it("does not retry a second 40101", async () => {
    const wallet = Wallet.createRandom();
    const signer: WalletSigner = {
      address: wallet.address,
      managesOwnFees: false,
      signMessage: (message) => wallet.signMessage(message),
      signTypedData: (domain, types, value) =>
        wallet.signTypedData(domain, types, value),
      submitTransaction: async () => {
        throw new Error("not used");
      },
    };
    let logins = 0;
    setPlatformFetch(async (input) => {
      const url = new URL(String(input));
      const json = (status: number, body: unknown) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      if (url.pathname === "/auth/nonce")
        return json(200, {
          nonce: "n",
          scopeId: SCOPE,
          issuedAt: "2026-09-02T12:22:49Z",
          chainId: 11155420,
          statement: "Sign in",
        });
      logins += 1;
      return json(401, { code: 40101, message: "invalid or expired nonce" });
    });
    await expect(
      loginWithSigner(
        { domain: "predict.prax1s.xyz", scopeId: SCOPE, chain: "op-sepolia" },
        signer,
        { reason: "test" },
      ),
    ).rejects.toMatchObject({ code: "40101" });
    expect(logins).toBe(2);
  });
});
