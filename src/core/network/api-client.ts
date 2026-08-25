import Constants from "expo-constants";
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

function buildNumber(): string {
  if (Platform.OS === "ios") {
    return Constants.expoConfig?.ios?.buildNumber ?? "0";
  }
  return String(Constants.expoConfig?.android?.versionCode ?? 0);
}

export const appRuntime = {
  version: Constants.expoConfig?.version ?? "1.0.0",
  buildNumber: buildNumber(),
  platform: Platform.OS === "ios" ? "ios" : "android",
  distributionChannel: distributionChannel(),
  runtimeVersion: Updates.runtimeVersion ?? "embedded",
} as const;

class ApiClient {
  async get<T>(
    path: string,
    schema: z.ZodType<T>,
    options?: { signal?: AbortSignal; headers?: Record<string, string> },
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort("timeout"),
      DEFAULT_TIMEOUT_MS,
    );
    const abortFromCaller = (): void => controller.abort("cancelled");
    options?.signal?.addEventListener("abort", abortFromCaller, { once: true });

    try {
      const response = await globalThis.fetch(`${baseUrl()}${path}`, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "X-App-Version": appRuntime.version,
          "X-Build-Number": appRuntime.buildNumber,
          "X-Platform": appRuntime.platform,
          "X-Distribution-Channel": appRuntime.distributionChannel,
          "X-Runtime-Version": appRuntime.runtimeVersion,
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
        );
      }

      const parsed = schema.safeParse(await response.json());
      if (!parsed.success) {
        throw new AppError(
          "incompatible_response",
          "The server response does not match the mobile contract",
          false,
          requestId,
          { cause: parsed.error },
        );
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      if (controller.signal.aborted) {
        const timedOut = controller.signal.reason === "timeout";
        throw new AppError(
          timedOut ? "timeout" : "cancelled",
          timedOut ? "The request timed out" : "The request was cancelled",
          timedOut,
          undefined,
          { cause: error },
        );
      }
      throw new AppError(
        "network",
        "The service is unreachable",
        true,
        undefined,
        {
          cause: error,
        },
      );
    } finally {
      clearTimeout(timeout);
      options?.signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

export const apiClient = new ApiClient();
