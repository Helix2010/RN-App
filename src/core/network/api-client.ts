import Constants from "expo-constants";
import * as Application from "expo-application";
import * as Updates from "expo-updates";
import { Platform } from "react-native";
import type { z } from "zod";
import { AppError } from "./app-error";
import { logEvent } from "../diagnostics/log-buffer";
import { pathTemplate } from "../diagnostics/path-template";
import { now } from "../time/clock";
import { resolveApiBaseUrl, resolveRuntimeVersion } from "./runtime-config";

const DEFAULT_TIMEOUT_MS = 8_000;
const configuredApiBaseUrl = resolveApiBaseUrl(
  Constants.expoConfig?.extra?.apiBaseUrl,
);

function baseUrl(): string | null {
  return configuredApiBaseUrl;
}

function distributionChannel(): string {
  const value = Constants.expoConfig?.extra?.distributionChannel;
  return typeof value === "string" ? value : "development";
}

function publicExtra(name: string, fallback: string): string {
  const value = Constants.expoConfig?.extra?.[name];
  return typeof value === "string" && value !== "" ? value : fallback;
}

function appVersion(): string {
  return (
    Application.nativeApplicationVersion ??
    publicExtra("appVersion", Constants.expoConfig?.version ?? "1.0.0")
  );
}

function buildNumber(): string {
  if (Application.nativeBuildVersion) return Application.nativeBuildVersion;
  const configured = Constants.expoConfig?.extra?.buildNumber;
  if (typeof configured === "string" && configured !== "") return configured;
  if (Platform.OS === "ios") {
    return Constants.expoConfig?.ios?.buildNumber ?? "0";
  }
  return String(Constants.expoConfig?.android?.versionCode ?? 0);
}

export const appRuntime = {
  version: appVersion(),
  buildNumber: buildNumber(),
  platform: Platform.OS === "ios" ? "ios" : "android",
  distributionChannel: distributionChannel(),
  otaChannel: publicExtra("otaChannel", distributionChannel()),
  runtimeVersion: resolveRuntimeVersion(Updates.runtimeVersion),
  apiBaseUrl: baseUrl() ?? "",
  applicationId: publicExtra("applicationId", "dex-mobile"),
  /**
   * bootstrap 响应签名者的地址（安全评审 N3）。空串 = 这个租户还没开签名。
   * 它随包发布（走 manifest extra，而 manifest 本身已经有代码签名），
   * 与 apiBaseUrl 同一个信任级别。
   */
  bootstrapSignerAddress: publicExtra("bootstrapSignerAddress", ""),
} as const;

/**
 * 请求失败进诊断日志（设计 diagnostic-report-2026-09-14 §4.2）。
 *
 * 只记接口模板、失败类型、状态码、业务码、requestId、耗时。**不记**请求头、请求体、
 * 响应体——安装凭证、会话令牌、地址都在那里面。取消不记：那是调用方主动放弃，不是故障。
 */
function recordFailure(
  method: "GET" | "POST",
  path: string,
  error: AppError,
  startedAt: number,
): AppError {
  if (error.kind === "cancelled") return error;
  const clientError =
    error.kind === "server" &&
    error.status !== undefined &&
    error.status < 500 &&
    error.status !== 429;
  logEvent(clientError ? "warn" : "error", "net", "request failed", {
    method,
    path: pathTemplate(path),
    kind: error.kind,
    ...(error.status !== undefined ? { status: error.status } : {}),
    ...(error.code ? { code: error.code } : {}),
    ...(error.requestId ? { requestId: error.requestId } : {}),
    ms: now() - startedAt,
  });
  return error;
}

class ApiClient {
  private async response(
    path: string,
    options?: {
      signal?: AbortSignal;
      headers?: Record<string, string>;
      method?: "GET" | "POST";
      body?: string;
      /** 单次请求的超时；大响应（bootstrap）在弱网下需要比默认 8 秒更宽 */
      timeoutMs?: number;
    },
  ): Promise<Response> {
    const startedAt = now();
    const method = options?.method ?? "GET";
    const apiBaseUrl = baseUrl();
    if (!apiBaseUrl) {
      throw new AppError(
        "configuration",
        "The packaged app is missing its tenant API base URL",
        false,
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort("timeout"),
      options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const abortFromCaller = (): void => controller.abort("cancelled");
    options?.signal?.addEventListener("abort", abortFromCaller, { once: true });
    try {
      const response = await globalThis.fetch(`${apiBaseUrl}${path}`, {
        method,
        body: options?.body,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "X-App-Version": appRuntime.version,
          "X-Build-Number": appRuntime.buildNumber,
          "X-Platform": appRuntime.platform,
          "X-Distribution-Channel": appRuntime.distributionChannel,
          "X-Runtime-Version": appRuntime.runtimeVersion,
          "X-Application-ID": appRuntime.applicationId,
          ...options?.headers,
        },
      });
      const requestId = response.headers.get("x-request-id") ?? undefined;
      if (!response.ok) {
        throw recordFailure(
          method,
          path,
          new AppError(
            "server",
            `Request failed with status ${response.status}`,
            response.status >= 500 || response.status === 429,
            requestId,
            response.status,
            { code: await problemCode(response) },
          ),
          startedAt,
        );
      }
      return response;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (controller.signal.aborted) {
        const timedOut = controller.signal.reason === "timeout";
        throw recordFailure(
          method,
          path,
          new AppError(
            timedOut ? "timeout" : "cancelled",
            timedOut ? "The request timed out" : "The request was cancelled",
            timedOut,
            undefined,
            undefined,
            { cause: error },
          ),
          startedAt,
        );
      }
      throw recordFailure(
        method,
        path,
        new AppError(
          "network",
          "The service is unreachable",
          true,
          undefined,
          undefined,
          { cause: error },
        ),
        startedAt,
      );
    } finally {
      clearTimeout(timeout);
      options?.signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  async get<T>(
    path: string,
    schema: z.ZodType<T>,
    options?: {
      signal?: AbortSignal;
      headers?: Record<string, string>;
      timeoutMs?: number;
    },
  ): Promise<T> {
    const startedAt = now();
    const response = await this.response(path, options);
    const requestId = response.headers.get("x-request-id") ?? undefined;
    try {
      const parsed = schema.safeParse(await response.json());
      if (!parsed.success) {
        throw recordFailure(
          "GET",
          path,
          new AppError(
            "incompatible_response",
            "The server response does not match the mobile contract",
            false,
            requestId,
            undefined,
            { cause: parsed.error },
          ),
          startedAt,
        );
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw recordFailure(
        "GET",
        path,
        new AppError(
          "incompatible_response",
          "The server response is not valid JSON",
          false,
          requestId,
          undefined,
          { cause: error },
        ),
        startedAt,
      );
    }
  }

  async getText(
    path: string,
    options?: {
      signal?: AbortSignal;
      headers?: Record<string, string>;
      timeoutMs?: number;
    },
  ): Promise<{ text: string; headers: Headers }> {
    const response = await this.response(path, options);
    return { text: await response.text(), headers: response.headers };
  }

  async post<T>(
    path: string,
    body: unknown,
    schema: z.ZodType<T>,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<T> {
    const startedAt = now();
    const response = await this.response(path, {
      ...options,
      headers: { "content-type": "application/json", ...options?.headers },
      method: "POST",
      body: JSON.stringify(body),
    });
    const requestId = response.headers.get("x-request-id") ?? undefined;
    try {
      const parsed = schema.safeParse(await response.json());
      if (!parsed.success)
        throw recordFailure(
          "POST",
          path,
          new AppError(
            "incompatible_response",
            "The server response does not match the mobile contract",
            false,
            requestId,
            undefined,
            { cause: parsed.error },
          ),
          startedAt,
        );
      return parsed.data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw recordFailure(
        "POST",
        path,
        new AppError(
          "incompatible_response",
          "The server response is not valid JSON",
          false,
          requestId,
          undefined,
          { cause: error },
        ),
        startedAt,
      );
    }
  }
}

/** 服务端错误体是 problem JSON（{code, detail, …}）时取出业务码；不是 JSON 就没有。 */
async function problemCode(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "code" in body) {
      const code = (body as { code?: unknown }).code;
      return typeof code === "string" ? code : undefined;
    }
  } catch {
    // 非 JSON 错误体
  }
  return undefined;
}

export const apiClient = new ApiClient();
