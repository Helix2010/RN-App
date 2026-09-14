import { z } from "zod";
import { clearLogs, snapshotLogs } from "../diagnostics/log-buffer";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: "https://api.test" } } },
}));

// eslint-disable-next-line import/first -- 必须在 expo-constants 的 mock 之后加载：基址在模块加载时就解析了
import { apiClient } from "./api-client";

const originalFetch = global.fetch;

function respond(status: number, body: unknown, requestId = "req-1"): void {
  global.fetch = jest.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "x-request-id": requestId },
      }),
  );
}

beforeEach(() => clearLogs());
afterEach(() => {
  global.fetch = originalFetch;
});

describe("request failures reach the diagnostics log", () => {
  it("records a server error as an interface template, never the query string", async () => {
    respond(503, { code: "UPSTREAM_DOWN" });
    await expect(
      apiClient.get(
        "/v1/mobile/wallet/transfers?limit=50&cursor=secret-cursor",
        z.object({}),
        { headers: { Authorization: "Session tok_live_abcdef" } },
      ),
    ).rejects.toMatchObject({ kind: "server", status: 503 });

    const [entry] = snapshotLogs();
    expect(entry).toMatchObject({
      level: "error",
      tag: "net",
      message: "request failed",
      fields: {
        method: "GET",
        path: "/v1/mobile/wallet/transfers",
        kind: "server",
        status: 503,
        code: "UPSTREAM_DOWN",
        requestId: "req-1",
      },
    });
    expect(typeof entry?.fields?.ms).toBe("number");
    // 请求头、查询串都不能进外泄通道
    const serialized = JSON.stringify(snapshotLogs());
    expect(serialized).not.toContain("secret-cursor");
    expect(serialized).not.toContain("tok_live");
  });

  it("records a client error as a warning", async () => {
    respond(404, { code: "NOT_FOUND" });
    await expect(
      apiClient.post(
        "/v1/mobile/auth/verify",
        { signature: "0xdead" },
        z.object({}),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(snapshotLogs()[0]).toMatchObject({
      level: "warn",
      fields: { method: "POST", path: "/v1/mobile/auth/verify", status: 404 },
    });
    // 请求体同样不能进
    expect(JSON.stringify(snapshotLogs())).not.toContain("0xdead");
  });

  it("treats rate limiting as an error, not a client mistake", async () => {
    respond(429, {});
    await expect(
      apiClient.get("/v1/mobile/bootstrap", z.object({})),
    ).rejects.toMatchObject({ status: 429 });
    expect(snapshotLogs()[0]?.level).toBe("error");
  });

  it("records an unreachable service", async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError("Network request failed");
    });
    await expect(
      apiClient.get("/v1/mobile/bootstrap", z.object({})),
    ).rejects.toMatchObject({ kind: "network" });
    expect(snapshotLogs()[0]?.fields).toMatchObject({ kind: "network" });
  });

  it("records a response that breaks the mobile contract", async () => {
    respond(200, { unexpected: true });
    await expect(
      apiClient.get(
        "/v1/mobile/auth/session",
        z.object({ address: z.string() }),
      ),
    ).rejects.toMatchObject({ kind: "incompatible_response" });
    expect(snapshotLogs()[0]?.fields).toMatchObject({
      kind: "incompatible_response",
      path: "/v1/mobile/auth/session",
    });
  });

  it("does not record a request the caller cancelled", async () => {
    global.fetch = jest.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    const controller = new AbortController();
    const pending = apiClient.get("/v1/mobile/bootstrap", z.object({}), {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: "cancelled" });
    expect(snapshotLogs()).toHaveLength(0);
  });

  it("does not record a success", async () => {
    respond(200, {});
    await apiClient.get("/v1/mobile/bootstrap", z.object({}));
    expect(snapshotLogs()).toHaveLength(0);
  });
});
