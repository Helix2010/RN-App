import Constants from "expo-constants";
import * as Application from "expo-application";
import * as Updates from "expo-updates";
import { Platform } from "react-native";
import type { z } from "zod";
import { AppError } from "./app-error";

const DEFAULT_TIMEOUT_MS = 8_000;

function baseUrl(): string {
  const configured = Constants.expoConfig?.extra?.apiBaseUrl;
  return typeof configured === "string"
    ? configured.replace(/\/$/, "")
    : "http://localhost:3000";
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
  runtimeVersion: Updates.runtimeVersion ?? "embedded",
  apiBaseUrl: baseUrl(),
  applicationId: publicExtra("applicationId", "dex-mobile"),
} as const;

class ApiClient {
  private async response(
    path: string,
    options?: {
      signal?: AbortSignal;
      headers?: Record<string, string>;
      method?: "GET" | "POST";
      body?: string;
    },
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort("timeout"),
      DEFAULT_TIMEOUT_MS,
    );
    const abortFromCaller = (): void => controller.abort("cancelled");
    options?.signal?.addEventListener("abort", abortFromCaller, { once: true });
    try {
      const response = await globalThis.fetch(`${baseUrl()}${path}`, {
        method: options?.method ?? "GET",
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
        throw new AppError(
          "server",
          `Request failed with status ${response.status}`,
          response.status >= 500 || response.status === 429,
          requestId,
          response.status,
        );
      }
      return response;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (controller.signal.aborted) {
        const timedOut = controller.signal.reason === "timeout";
        throw new AppError(
          timedOut ? "timeout" : "cancelled",
          timedOut ? "The request timed out" : "The request was cancelled",
          timedOut,
          undefined,
          undefined,
          { cause: error },
        );
      }
      throw new AppError(
        "network",
        "The service is unreachable",
        true,
        undefined,
        undefined,
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
      options?.signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  async get<T>(
    path: string,
    schema: z.ZodType<T>,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<T> {
    const response = await this.response(path, options);
    const requestId = response.headers.get("x-request-id") ?? undefined;
    try {
      const parsed = schema.safeParse(await response.json());
      if (!parsed.success) {
        throw new AppError(
          "incompatible_response",
          "The server response does not match the mobile contract",
          false,
          requestId,
          undefined,
          { cause: parsed.error },
        );
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "incompatible_response",
        "The server response is not valid JSON",
        false,
        requestId,
        undefined,
        { cause: error },
      );
    }
  }

  async getText(
    path: string,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
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
        throw new AppError(
          "incompatible_response",
          "The server response does not match the mobile contract",
          false,
          requestId,
          undefined,
          { cause: parsed.error },
        );
      return parsed.data;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "incompatible_response",
        "The server response is not valid JSON",
        false,
        requestId,
        undefined,
        { cause: error },
      );
    }
  }
}

export const apiClient = new ApiClient();
