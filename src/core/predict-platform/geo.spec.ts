import { fetchRegionAccess } from "./geo";
import { setPlatformFetch } from "./tenant-client";

const service = {
  domain: "predict.prax1s.xyz",
  scopeId: `0x${"fb".repeat(32)}`,
  chain: "op-sepolia" as const,
};

afterEach(() => setPlatformFetch(null));

describe("region access", () => {
  it("does not ask anyone when the tenant has no geo endpoint", async () => {
    const fetchMock = jest.fn();
    setPlatformFetch(fetchMock);
    await expect(fetchRegionAccess(service)).resolves.toEqual({
      restricted: false,
      checked: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks {geo}/geoblock with the tenant header and reports the verdict", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    setPlatformFetch(async (input, init) => {
      seen.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return new Response(JSON.stringify({ restricted: true, country: "XX" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await expect(
      fetchRegionAccess({
        ...service,
        endpoints: { geo: "https://geo.example.net/check" },
      }),
    ).resolves.toEqual({ restricted: true, checked: true });
    expect(seen[0]?.url).toBe("https://geo.example.net/check/geoblock");
    expect(seen[0]?.headers["X-Tenant-Domain"]).toBe("predict.prax1s.xyz");
  });

  it("fails instead of allowing when the service errors or breaks the contract", async () => {
    setPlatformFetch(async () => new Response("nope", { status: 500 }));
    await expect(
      fetchRegionAccess({
        ...service,
        endpoints: { geo: "https://geo.example.net" },
      }),
    ).rejects.toBeTruthy();
    setPlatformFetch(
      async () =>
        new Response(JSON.stringify({ restricted: "yes" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await expect(
      fetchRegionAccess({
        ...service,
        endpoints: { geo: "https://geo.example.net" },
      }),
    ).rejects.toBeTruthy();
  });
});
