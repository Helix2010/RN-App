import { z } from "zod";
import {
  PlatformHttpError,
  PlatformRateLimitedError,
  platformHosts,
  platformRequest,
  setPlatformFetch,
} from "./tenant-client";

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => setPlatformFetch(null));

describe("platformHosts", () => {
  it("derives the six service hosts from the tenant domain over https/wss", () => {
    expect(platformHosts("predict.prax1s.xyz")).toEqual({
      gamma: "https://gamma-api.predict.prax1s.xyz",
      clob: "https://clob-api.predict.prax1s.xyz",
      clobWs: "wss://clob-ws.predict.prax1s.xyz",
      data: "https://data-api.predict.prax1s.xyz",
      relayer: "https://relayer.predict.prax1s.xyz",
      faucet: "https://faucet.predict.prax1s.xyz",
    });
  });
});

describe("platformRequest", () => {
  it("always sends X-Tenant-Domain: a missing header silently maps to tenant 0 on the platform", async () => {
    const seen: RequestInit[] = [];
    setPlatformFetch(async (_url, init) => {
      seen.push(init ?? {});
      return respond(200, { ok: true });
    });
    await platformRequest({
      url: "https://gamma-api.predict.prax1s.xyz/public-info",
      tenantDomain: "predict.prax1s.xyz",
      schema: z.object({ ok: z.boolean() }),
    });
    expect(
      (seen[0]?.headers as Record<string, string>)["X-Tenant-Domain"],
    ).toBe("predict.prax1s.xyz");
  });

  it("maps the platform error envelopes and rate limiting to typed errors", async () => {
    setPlatformFetch(async () =>
      respond(401, { code: 40101, message: "nonce expired" }),
    );
    await expect(
      platformRequest({
        url: "https://x",
        tenantDomain: "d",
        schema: z.unknown(),
      }),
    ).rejects.toMatchObject({
      status: 401,
      code: "40101",
      message: "nonce expired",
    });

    setPlatformFetch(async () => respond(403, { error: "scopeId mismatch" }));
    const error = await platformRequest({
      url: "https://x",
      tenantDomain: "d",
      schema: z.unknown(),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PlatformHttpError);
    expect((error as PlatformHttpError).code).toBe("scopeId mismatch");

    setPlatformFetch(async () => respond(429, {}));
    await expect(
      platformRequest({
        url: "https://x",
        tenantDomain: "d",
        schema: z.unknown(),
      }),
    ).rejects.toBeInstanceOf(PlatformRateLimitedError);
  });

  it("rejects a 200 whose body does not match the schema instead of using it", async () => {
    setPlatformFetch(async () => respond(200, { nonce: 42 }));
    await expect(
      platformRequest({
        url: "https://x",
        tenantDomain: "d",
        schema: z.object({ nonce: z.string() }),
      }),
    ).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
  });
});
