import {
  MANUAL_REPORT_INTERVAL_MS,
  prepareReport,
  resetReportThrottleForTest,
  submitReport,
} from "./report-service";
import { clearLogs, logEvent } from "./log-buffer";
import { AppError } from "../network/app-error";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiBaseUrl: "https://api.test" } } },
}));

// 每次一个新 id：两次上报用同一个 id 在服务端就是同一条（幂等）
let mockUuidCounter = 0;
jest.mock("expo-crypto", () => ({
  randomUUID: () =>
    `0123456789ab4def8123${String((mockUuidCounter += 1)).padStart(12, "0")}`,
}));

const mockEnsure = jest.fn();
jest.mock("../device/installation-service", () => ({
  ensureInstallationAuthorization: () => mockEnsure(),
  runningBundle: () => ({
    launchSource: "ota",
    runningUpdateId: "7c5c1363-8685-42b2-864e-38b6790471ca",
  }),
  deviceDescriptor: () => ({ osVersion: "35", deviceClass: "android-phone" }),
}));

type Call = {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
};
let calls: Call[] = [];
const originalFetch = global.fetch;

function serve(responses: { status: number; body: unknown }[]): void {
  const queue = [...responses];
  global.fetch = jest.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        body: String(init?.body ?? ""),
        headers: init?.headers as Record<string, string>,
      });
      const next = queue.shift() ?? { status: 500, body: {} };
      return new Response(JSON.stringify(next.body), { status: next.status });
    },
  );
}

const created = (required = true) => ({
  status: 201,
  body: { reportId: "x", reference: "R7KQ3M2X", logUpload: { required } },
});

beforeEach(() => {
  calls = [];
  clearLogs();
  resetReportThrottleForTest();
  mockEnsure.mockResolvedValue({
    "X-Installation-ID": "inst_abc",
    Authorization: "Installation cred",
  });
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe("prepareReport", () => {
  it("snapshots the log buffer and derives the context from it", () => {
    logEvent("info", "nav", "route", { name: "Transfer" });
    logEvent("error", "net", "request failed", {
      requestId: "req-9",
      status: 503,
    });
    const prepared = prepareReport({ kind: "user", locale: "zh-CN" });

    expect(prepared.reportId).toMatch(/^rpt_[0-9a-f]{32}$/);
    expect(prepared.entries).toHaveLength(2);
    expect(prepared.context).toEqual({
      screen: "Transfer",
      lastRequestId: "req-9",
    });
    expect(prepared.app).toMatchObject({
      launchSource: "ota",
      locale: "zh-CN",
      osVersion: "35",
    });
  });
});

describe("submitReport", () => {
  it("sends metadata first and the very same entries the user was shown as the log", async () => {
    logEvent("info", "nav", "route", { name: "Assets" });
    const prepared = prepareReport({ kind: "user", locale: "zh-CN" });
    // 用户看预览时又产生了新日志：发出去的必须仍是预览里那一份
    logEvent("error", "net", "request failed after preview");
    serve([created(), { status: 200, body: { reference: "R7KQ3M2X" } }]);

    const outcome = await submitReport(prepared, "  转账一直转圈  ");

    expect(outcome).toEqual({
      status: "submitted",
      reference: "R7KQ3M2X",
      logStored: true,
    });
    const [meta, log] = calls;
    expect(meta?.method).toBe("POST");
    expect(meta?.url).toBe("https://api.test/v1/mobile/diagnostics/reports");
    const body = JSON.parse(meta?.body ?? "{}") as Record<string, unknown>;
    expect(body.note).toBe("转账一直转圈");
    expect(body).not.toHaveProperty("entries");
    // 身份一律由服务端解析，请求体里一个都不能有
    for (const key of [
      "tenantId",
      "userId",
      "installationId",
      "address",
      "walletAddress",
    ])
      expect(body).not.toHaveProperty(key);
    expect(meta?.headers["X-Installation-ID"]).toBe("inst_abc");

    expect(log?.method).toBe("PUT");
    expect(log?.url).toBe(
      `https://api.test/v1/mobile/diagnostics/reports/${prepared.reportId}/log`,
    );
    expect(log?.headers["content-type"]).toBe("application/x-ndjson");
    expect(log?.body.split("\n")).toHaveLength(1);
    expect(log?.body).not.toContain("after preview");
  });

  it("never sends a note with an automatic crash report", async () => {
    serve([created(false)]);
    await submitReport(
      prepareReport({
        kind: "crash_auto",
        locale: "zh-CN",
        crash: { fingerprint: "a1b2c3d4e5f60718", errorName: "TypeError" },
      }),
      "should not be sent",
    );
    expect(JSON.parse(calls[0]?.body ?? "{}")).not.toHaveProperty("note");
  });

  it("skips the log upload when the server has nowhere to store it", async () => {
    logEvent("info", "nav", "route", { name: "Assets" });
    serve([created(false)]);
    const outcome = await submitReport(
      prepareReport({ kind: "user", locale: "zh-CN" }),
    );
    expect(outcome).toEqual({
      status: "submitted",
      reference: "R7KQ3M2X",
      logStored: false,
    });
    expect(calls).toHaveLength(1);
  });

  it("still returns the reference when only the log upload fails", async () => {
    logEvent("info", "nav", "route", { name: "Assets" });
    serve([created(), { status: 503, body: {} }]);
    const outcome = await submitReport(
      prepareReport({ kind: "user", locale: "zh-CN" }),
    );
    expect(outcome).toEqual({
      status: "submitted",
      reference: "R7KQ3M2X",
      logStored: false,
    });
  });

  it.each([
    [429, "quota"],
    [404, "disabled"],
    [401, "credential"],
    [500, "unavailable"],
  ] as const)("maps HTTP %s to %s", async (status, reason) => {
    serve([{ status, body: {} }]);
    expect(
      await submitReport(prepareReport({ kind: "user", locale: "zh-CN" })),
    ).toEqual({
      status: "failed",
      reason,
    });
  });

  it("reports a missing installation registration as a credential problem", async () => {
    mockEnsure.mockRejectedValue(
      new AppError(
        "configuration",
        "not registered",
        false,
        undefined,
        undefined,
        {
          code: "INSTALLATION_REQUIRED",
        },
      ),
    );
    serve([]);
    expect(
      await submitReport(prepareReport({ kind: "user", locale: "zh-CN" })),
    ).toEqual({
      status: "failed",
      reason: "credential",
    });
    expect(calls).toHaveLength(0);
  });

  it("reports an unreachable service as a network problem", async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError("Network request failed");
    });
    expect(
      await submitReport(prepareReport({ kind: "user", locale: "zh-CN" })),
    ).toEqual({
      status: "failed",
      reason: "network",
    });
  });

  it("throttles repeated manual reports but not automatic ones", async () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
    serve([created(false), created(false), created(false)]);
    await submitReport(prepareReport({ kind: "user", locale: "zh-CN" }));
    expect(
      await submitReport(prepareReport({ kind: "user", locale: "zh-CN" })),
    ).toEqual({
      status: "failed",
      reason: "throttled",
    });
    expect(calls).toHaveLength(1);

    const crash = { fingerprint: "a1b2c3d4e5f60718", errorName: "TypeError" };
    expect(
      (
        await submitReport(
          prepareReport({ kind: "crash_auto", locale: "zh-CN", crash }),
        )
      ).status,
    ).toBe("submitted");

    nowSpy.mockReturnValue(1_000_000 + MANUAL_REPORT_INTERVAL_MS);
    expect(
      (await submitReport(prepareReport({ kind: "user", locale: "zh-CN" })))
        .status,
    ).toBe("submitted");
  });

  it("does not start the throttle when the report never reached the server", async () => {
    serve([{ status: 503, body: {} }, created(false)]);
    await submitReport(prepareReport({ kind: "user", locale: "zh-CN" }));
    expect(
      (await submitReport(prepareReport({ kind: "user", locale: "zh-CN" })))
        .status,
    ).toBe("submitted");
  });
});
