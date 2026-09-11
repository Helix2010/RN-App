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

/** bootstrap 请求超时：比通用 8 秒宽，启动门禁与手动检查共用 */
const BOOTSTRAP_TIMEOUT_MS = 15_000;
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

/**
 * 本机认定的语言包租户。
 *
 * 语言包自带 `tenantId`，但客户端没有可以对照的权威租户号——bootstrap 不下发它。
 * 所以第一次成功应用时把它钉住，之后只接受同一个租户的包：域名指错、网关路由
 * 串了、或者有人把另一个租户的包塞进来时，界面文案会整体被替换（含金额单位、
 * 风险提示、按钮语义），这类替换必须挡住而不是照单全收（安全评审 N27）。
 */
function languageTenantKey(locale: SupportedLocale): string {
  return `${languagePackageKey(locale)}.tenant`;
}

async function assertLanguageTenant(
  locale: SupportedLocale,
  tenantId: string,
): Promise<void> {
  const key = languageTenantKey(locale);
  const pinned = await AsyncStorage.getItem(key);
  if (pinned === null) {
    await AsyncStorage.setItem(key, tenantId);
    return;
  }
  if (pinned !== tenantId)
    throw new Error(
      `language resource tenant mismatch: expected ${pinned}, got ${tenantId}`,
    );
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
      const pinnedTenant = await AsyncStorage.getItem(
        languageTenantKey(config.localization.selectedLocale),
      );
      if (
        parsed.success &&
        parsed.data.languageCode === config.localization.selectedLocale &&
        parsed.data.version === resource.version &&
        (pinnedTenant === null || parsed.data.tenantId === pinnedTenant)
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
    await assertLanguageTenant(
      config.localization.selectedLocale,
      packageValue.tenantId,
    );
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
      // 退回缓存时同样要过租户这一关。少了它，"拒收别家语言包"就只挡住了
      // 本次下载：抛错之后照样把缓存里的整套文案铺上去（安全评审 N27）。
      const pinnedTenant = await AsyncStorage.getItem(
        languageTenantKey(config.localization.selectedLocale),
      );
      if (
        !parsed.success ||
        parsed.data.languageCode !== config.localization.selectedLocale ||
        (pinnedTenant !== null && parsed.data.tenantId !== pinnedTenant)
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
    // 60 KB 的下发在弱网下 8 秒会误判超时（真机实测过一次"暂时无法获取远程配置"）
    { signal, timeoutMs: BOOTSTRAP_TIMEOUT_MS },
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
