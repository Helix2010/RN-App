import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { apiClient } from "../network/api-client";
import {
  bootstrapSchema,
  type BootstrapConfig,
  type SupportedLocale,
} from "./bootstrap.schema";
import { createFallbackConfig } from "./fallback-config";

const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const cacheSchema = z.object({
  savedAt: z.number(),
  config: bootstrapSchema,
});

export type BootstrapSnapshot = {
  config: BootstrapConfig;
  source: "remote" | "cache" | "fallback";
  stale: boolean;
  lastError?: Error;
};

function cacheKey(locale: SupportedLocale): string {
  return `foundation.bootstrap.v1.${locale}`;
}

async function discardInvalidCache(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    console.warn(
      "Unable to remove invalid bootstrap cache",
      error instanceof Error ? error.name : "UnknownError",
    );
  }
}

async function readCache(
  locale: SupportedLocale,
): Promise<BootstrapConfig | null> {
  const key = cacheKey(locale);
  const value = await AsyncStorage.getItem(key);
  if (!value) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    await discardInvalidCache(key);
    return null;
  }

  const parsed = cacheSchema.safeParse(decoded);
  if (!parsed.success || Date.now() - parsed.data.savedAt > MAX_CACHE_AGE_MS) {
    await discardInvalidCache(key);
    return null;
  }
  return parsed.data.config;
}

export async function loadBootstrap(
  locale: SupportedLocale,
  signal?: AbortSignal,
): Promise<BootstrapSnapshot> {
  try {
    const config = await apiClient.get(
      `/v1/mobile/bootstrap?locale=${encodeURIComponent(locale)}`,
      bootstrapSchema,
      { signal },
    );
    await AsyncStorage.setItem(
      cacheKey(locale),
      JSON.stringify({ savedAt: Date.now(), config }),
    );
    return { config, source: "remote", stale: false };
  } catch (error) {
    const lastError =
      error instanceof Error ? error : new Error("Unknown error");
    const cached = await readCache(locale);
    if (cached) {
      return { config: cached, source: "cache", stale: true, lastError };
    }
    return {
      config: createFallbackConfig(locale),
      source: "fallback",
      stale: true,
      lastError,
    };
  }
}
