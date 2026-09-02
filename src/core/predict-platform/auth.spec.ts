import { Wallet, verifyTypedData } from "ethers";
import { decodeJwt, jwtUsable, loginTypedData } from "./auth";

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
