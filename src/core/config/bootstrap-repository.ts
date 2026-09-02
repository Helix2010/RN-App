import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { z } from "zod";
import { apiClient, appRuntime } from "../network/api-client";
import {
  bootstrapSchema,
  type BootstrapConfig,
  type SupportedLocale,
} from "./bootstrap.schema";
import { createFallbackConfig } from "./fallback-config";
import { normalizeMessages } from "./localization";
import { hydrateCachedBranding } from "./branding-assets";

const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const cacheSchema = z.object({
  savedAt: z.number(),
  config: bootstrapSchema,
});
const languagePackageSchema = z.object({
  schemaVersion: z.literal(1),
  tenantId: z.string(),
  languageCode: z.string(),
  version: z.string(),
  generatedAt: z.string(),
  messages: z.record(z.string(), z.string()),
});

export type BootstrapSnapshot = {
  config: BootstrapConfig;
  /** remote：本次从服务端拿到的；fallback：内置配置，只用于渲染启动门禁 */
  source: "remote" | "fallback";
};

function cacheKey(locale: SupportedLocale): string {
  return `foundation.bootstrap.v3.${encodeURIComponent(appRuntime.apiBaseUrl)}.${appRuntime.applicationId}.${locale}`;
}

function normalizeConfig(config: BootstrapConfig): BootstrapConfig {
  const embeddedMessages = createFallbackConfig(
    config.localization.selectedLocale,
  ).localization.messages;
  return {
    ...config,
    localization: {
      ...config.localization,
      messages: {
        ...embeddedMessages,
        ...normalizeMessages(config.localization.messages),
      },
    },
  };
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
  return hydrateCachedBranding(normalizeConfig(parsed.data.config));
}

export async function loadCachedBootstrap(
  locale: SupportedLocale,
): Promise<BootstrapConfig | null> {
  return readCache(locale);
}

function languagePackageKey(locale: SupportedLocale): string {
  return `foundation.language.v2.${encodeURIComponent(appRuntime.apiBaseUrl)}.${appRuntime.applicationId}.${locale}`;
}

async function applyRemoteLanguagePackage(
  config: BootstrapConfig,
  signal?: AbortSignal,
): Promise<BootstrapConfig> {
  const resource = config.localization.resource;
  if (!resource) return config;
  const cacheKeyValue = languagePackageKey(config.localization.selectedLocale);
  const cached = await AsyncStorage.getItem(cacheKeyValue);
  if (cached) {
    try {
      const parsed = languagePackageSchema.safeParse(JSON.parse(cached));
      if (
        parsed.success &&
        parsed.data.languageCode === config.localization.selectedLocale &&
        parsed.data.version === resource.version
      ) {
        return {
          ...config,
          localization: {
            ...config.localization,
            messages: {
              ...config.localization.messages,
              ...normalizeMessages(parsed.data.messages),
            },
            messagesVersion: parsed.data.version,
          },
        };
      }
    } catch {
      await discardInvalidCache(cacheKeyValue);
    }
  }
  try {
    const result = await apiClient.getText(resource.fileUrl, { signal });
    if (new Blob([result.text]).size !== resource.size)
      throw new Error("language resource size mismatch");
    const responseHash = result.headers.get("x-content-sha256");
    if (responseHash && responseHash !== resource.sha256)
      throw new Error("language resource header hash mismatch");
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      result.text,
      { encoding: Crypto.CryptoEncoding.HEX },
    );
    if (hash !== resource.sha256)
      throw new Error("language resource hash mismatch");
    const packageValue = languagePackageSchema.parse(JSON.parse(result.text));
    if (
      packageValue.languageCode !== config.localization.selectedLocale ||
      packageValue.version !== resource.version
    )
      throw new Error("language resource identity mismatch");
    await AsyncStorage.setItem(cacheKeyValue, result.text);
    return {
      ...config,
      localization: {
        ...config.localization,
        messages: {
          ...config.localization.messages,
          ...normalizeMessages(packageValue.messages),
        },
        messagesVersion: packageValue.version,
      },
    };
  } catch {
    if (!cached) return config;
    try {
      const parsed = languagePackageSchema.safeParse(JSON.parse(cached));
      if (
        !parsed.success ||
        parsed.data.languageCode !== config.localization.selectedLocale
      )
        return config;
      return {
        ...config,
        localization: {
          ...config.localization,
          messages: {
            ...config.localization.messages,
            ...normalizeMessages(parsed.data.messages),
          },
          messagesVersion: parsed.data.version,
        },
      };
    } catch {
      return config;
    }
  }
}

/**
 * 拿不到远程下发就是失败，错误原样抛出：不用上次的缓存冒充一份"配置"。
 * 缓存只供 loadCachedBootstrap 决定启动页画哪版品牌，业务界面不会跑在它上面。
 */
export async function loadBootstrap(
  locale: SupportedLocale,
  signal?: AbortSignal,
): Promise<BootstrapSnapshot> {
  const config = await apiClient.get(
    `/v1/mobile/bootstrap?locale=${encodeURIComponent(locale)}`,
    bootstrapSchema,
    { signal },
  );
  const enriched = await hydrateCachedBranding(
    await applyRemoteLanguagePackage(normalizeConfig(config), signal),
  );
  await AsyncStorage.setItem(
    cacheKey(locale),
    JSON.stringify({ savedAt: Date.now(), config: enriched }),
  );
  return { config: enriched, source: "remote" };
}
