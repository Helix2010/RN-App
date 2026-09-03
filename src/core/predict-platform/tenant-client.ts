import type { z } from "zod";
import { AppError } from "../network/app-error";

/**
 * 预测平台的 HTTP 客户端。
 *
 * 平台按域名识别租户：请求头 `X-Tenant-Domain` 缺失时它会**静默落到租户 0**而不是
 * 报错。所以所有请求只能从这里发出——租户头在这里统一加上，没有别的入口。
 * 服务地址按平台自己的规则从租户域名派生（`serviceUrls.ts`），只走 https / wss。
 */

const DEFAULT_TIMEOUT_MS = 15_000;
/** 429 退避：指数，最多重试 3 次（设计 §3.7），之后把限流原样抛给界面 */
const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BASE_DELAY_MS = 500;

type PlatformHosts = {
  gamma: string;
  clob: string;
  clobWs: string;
  data: string;
  relayer: string;
  faucet: string;
};

export function platformHosts(domain: string): PlatformHosts {
  return {
    gamma: `https://gamma-api.${domain}`,
    clob: `https://clob-api.${domain}`,
    clobWs: `wss://clob-ws.${domain}`,
    data: `https://data-api.${domain}`,
    relayer: `https://relayer.${domain}`,
    faucet: `https://faucet.${domain}`,
  };
}

/** 平台返回了非 2xx。`code` 是平台的错误码（gamma 是数字，relayer / clob 是文本）。 */
export class PlatformHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    detail: string,
  ) {
    super(detail);
    this.name = "PlatformHttpError";
  }
}

/** 平台按 IP 限流（手机用户经运营商 NAT 共用出口 IP，上量会撞线）。调用方退避，不重试风暴。 */
export class PlatformRateLimitedError extends PlatformHttpError {
  constructor(detail: string) {
    super(429, "RATE_LIMITED", detail);
    this.name = "PlatformRateLimitedError";
  }
}

type PlatformRequest<T> = {
  url: string;
  tenantDomain: string;
  schema: z.ZodType<T>;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
};

type FetchLike = typeof globalThis.fetch;
let fetchImpl: FetchLike = (...args) => globalThis.fetch(...args);

/** 仅供测试替换网络层。 */
export function setPlatformFetch(next: FetchLike | null): void {
  fetchImpl = next ?? ((...args) => globalThis.fetch(...args));
}

type SleepLike = (ms: number) => Promise<void>;
const realSleep: SleepLike = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));
let sleepImpl: SleepLike = realSleep;

/** 仅供测试替换退避等待。 */
export function setPlatformSleep(next: SleepLike | null): void {
  sleepImpl = next ?? realSleep;
}

function errorDetail(
  status: number,
  payload: unknown,
): { code: string; detail: string } {
  if (typeof payload === "string" && payload.trim().length > 0)
    return { code: `HTTP_${status}`, detail: payload.trim().slice(0, 200) };
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const code =
      record.code !== undefined
        ? String(record.code)
        : typeof record.error === "string"
          ? record.error
          : `HTTP_${status}`;
    const detail =
      typeof record.message === "string"
        ? record.message
        : typeof record.error === "string"
          ? record.error
          : `platform answered HTTP ${status}`;
    return { code, detail };
  }
  return { code: `HTTP_${status}`, detail: `platform answered HTTP ${status}` };
}

export async function platformRequest<T>(
  request: PlatformRequest<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await platformRequestOnce(request);
    } catch (error) {
      if (
        !(error instanceof PlatformRateLimitedError) ||
        attempt >= RATE_LIMIT_RETRIES ||
        request.signal?.aborted
      )
        throw error;
      await sleepImpl(RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt);
    }
  }
}

async function platformRequestOnce<T>(request: PlatformRequest<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort("timeout"),
    request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const abortFromCaller = (): void => controller.abort("cancelled");
  request.signal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const response = await fetchImpl(request.url, {
      method: request.method ?? "GET",
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        // 平台的租户识别：缺了会落到租户 0，所以每个请求都在这里加，没有例外
        "X-Tenant-Domain": request.tenantDomain,
        ...(request.body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
        ...request.headers,
      },
    });
    const text = await response.text();
    let payload: unknown = null;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        // 不是 JSON（clob 的 400 是纯文本）：原文留作错误详情
        payload = text;
      }
    }
    if (response.status === 429)
      throw new PlatformRateLimitedError(
        "the platform is rate limiting this client",
      );
    if (!response.ok) {
      const { code, detail } = errorDetail(response.status, payload);
      throw new PlatformHttpError(response.status, code, detail);
    }
    const parsed = request.schema.safeParse(payload);
    if (!parsed.success)
      throw new PlatformHttpError(
        response.status,
        "MALFORMED_RESPONSE",
        `unexpected response from ${request.url}: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`,
      );
    return parsed.data;
  } catch (error) {
    if (error instanceof PlatformHttpError) throw error;
    if (controller.signal.aborted && controller.signal.reason === "timeout")
      throw new AppError(
        "timeout",
        `the platform did not answer in time: ${request.url}`,
        true,
      );
    if (controller.signal.aborted)
      throw new AppError("cancelled", "the request was cancelled", false);
    throw new AppError(
      "network",
      `the platform is unreachable: ${request.url}`,
      true,
      undefined,
      undefined,
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
  }
}
