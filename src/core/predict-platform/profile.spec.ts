import {
  NICKNAME_MAX_LENGTH,
  ProfileNameTooLongError,
  fetchProfile,
  updateProfile,
} from "./profile";
import { setPlatformFetch } from "./tenant-client";

const service = {
  domain: "predict.prax1s.xyz",
  scopeId: `0x${"fb".repeat(32)}`,
  chain: "op-sepolia" as const,
};
type Seen = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
};

function stub(profile: unknown) {
  const seen: Seen[] = [];
  setPlatformFetch(async (input, init) => {
    seen.push({
      url: String(input),
      method: (init?.method ?? "GET").toUpperCase(),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : null,
    });
    return new Response(JSON.stringify(profile), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return seen;
}

afterEach(() => setPlatformFetch(null));

describe("platform profile", () => {
  it("reads the full profile by address without auth", async () => {
    const seen = stub({ id: "1", name: "Keen Bear", pseudonym: "Quiet-Fox" });
    const profile = await fetchProfile(
      service,
      "0xABCDEF0000000000000000000000000000000001",
    );
    expect(profile?.name).toBe("Keen Bear");
    expect(seen[0]?.url).toBe(
      "https://gamma-api.predict.prax1s.xyz/profiles/user_address/0xabcdef0000000000000000000000000000000001",
    );
    expect(seen[0]?.headers.Authorization).toBeUndefined();
  });

  it("treats the platform's 404 as 'no profile yet' and surfaces every other failure", async () => {
    setPlatformFetch(
      async () =>
        new Response(JSON.stringify({ code: 40400, message: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(fetchProfile(service, "0xdead")).resolves.toBeNull();
    setPlatformFetch(async () => new Response("boom", { status: 500 }));
    await expect(fetchProfile(service, "0xdead")).rejects.toBeTruthy();
  });

  it("updates the nickname with the gamma bearer token and only the name field", async () => {
    const seen = stub({ name: "Keen Bear", pseudonym: "Quiet-Fox" });
    await updateProfile(service, "jwt-1", { name: "  Keen Bear " });
    expect(seen[0]?.method).toBe("POST");
    expect(seen[0]?.url).toBe("https://gamma-api.predict.prax1s.xyz/profiles");
    expect(seen[0]?.headers.Authorization).toBe("Bearer jwt-1");
    expect(JSON.parse(seen[0]?.body ?? "{}")).toEqual({ name: "Keen Bear" });
  });

  it("refuses nicknames over the web client's 32-character limit before calling the platform", async () => {
    const seen = stub({});
    await expect(
      updateProfile(service, "jwt-1", {
        name: "x".repeat(NICKNAME_MAX_LENGTH + 1),
      }),
    ).rejects.toBeInstanceOf(ProfileNameTooLongError);
    expect(seen).toHaveLength(0);
  });
});
