import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { z } from "zod";
import { installationAuthorization } from "../device/installation-service";
import { AppError } from "../network/app-error";
import { apiClient, appRuntime } from "../network/api-client";
import { isReplayed, verifyBootstrapSignature } from "./bootstrap-signature";
import { rememberCanaryToken } from "../updates/canary-token";
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
/**
 * 缓存可以**代替远程下发放行业务页**的最长年龄。
 *
 * 比渲染启动页品牌用的 `MAX_CACHE_AGE_MS` 短得多，而且必须短：bootstrap 是一条
 * 安全控制通道，强制升级、下线一条链、改 RPC 端点都靠它。放行一份七天前的配置
 * 等于让这些决定七天内都到不了这台设备。一天是权衡后的上限——一次请求失败不该
 * 让设备打不开，但"长期离线还能进业务页"不在可接受范围里。
 */
export const MAX_CACHE_ENTRY_AGE_MS = 24 * 60 * 60 * 1_000;
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
  /**
   * - `remote`：本次真的从服务端拿到了。只有它能驱动更新判定。
   * - `cache`：这次请求失败，用的是上一次成功下发并落盘的那份（最多 7 天）。
   *   它足以让应用启动——那是一份验过 schema 的真实下发——但**不是新鲜的**，
   *   所以不能拿它决定"要不要升级"。
   * - `fallback`：内置配置，只用于渲染启动门禁本身。
   */
  source: "remote" | "cache" | "fallback";
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

/**
 * 缓存快照只用来决定启动页画哪版品牌，不该顺手把灰度令牌留在明文 AsyncStorage 里。
 * 令牌每次 bootstrap 都会重发，缓存里留着也没有用途。
 */
function withoutCanaryToken(config: BootstrapConfig): BootstrapConfig {
  if (!config.update.canary?.otaToken) return config;
  return {
    ...config,
    update: {
      ...config.update,
      canary: { ...config.update.canary, otaToken: null },
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
  maxAgeMs = MAX_CACHE_AGE_MS,
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
  // 比调用方要求的还旧：不算错误，也不清缓存（画启动页还用得上），只是这次不给。
  if (Date.now() - parsed.data.savedAt > maxAgeMs) return null;
  return hydrateCachedBranding(normalizeConfig(parsed.data.config));
}

/**
 * 读缓存。`maxAgeMs` 不传按 7 天——那是画启动页品牌用的窗口。要拿它**代替下发
 * 放行业务页**的调用方必须传 `MAX_CACHE_ENTRY_AGE_MS`。
 */
export async function loadCachedBootstrap(
  locale: SupportedLocale,
  maxAgeMs?: number,
): Promise<BootstrapConfig | null> {
  return readCache(locale, maxAgeMs);
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
/**
 * 配了签名者地址的租户，**没有签名就拒绝启动**（安全评审 N3）。
 *
 * 2026-09-12 打开。原本计划分两个版本上线（先"有就验"再"没有就拒"），那是为了
 * 不把还没升级的设备锁在门外；用户确认历史版本可以直接清理，所以跳过了中间那步。
 *
 * 翻回 false 只有一种正当理由：服务端的签名密钥出了事而又必须让 App 先能用。
 * 那时候要清楚这意味着什么——bootstrap 决定 RPC 端点、平台域名和更新策略，
 * 不验签就等于把这些交给任何能顶替那个响应的人。
 *
 * 没配签名者地址的租户不受影响：那种租户根本不进验签这条路。
 */
export const REQUIRE_BOOTSTRAP_SIGNATURE = true;

/** 见过的最大 issuedAt。按租户 + 应用分键，与配置缓存同一套键空间。 */
function issuedAtKey(): string {
  return `foundation.bootstrap.issued-at.v1.${encodeURIComponent(appRuntime.apiBaseUrl)}.${appRuntime.applicationId}`;
}

async function highestIssuedAt(): Promise<number> {
  try {
    const raw = await AsyncStorage.getItem(issuedAtKey());
    const value = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

async function rememberIssuedAt(issuedAt: number): Promise<void> {
  try {
    await AsyncStorage.setItem(issuedAtKey(), String(issuedAt));
  } catch {
    // 记不住只是让重放判定退化成"不判"，不该让启动失败
  }
}

/**
 * 验签 + 反重放。两者都**fail closed**：宁可停在启动门禁，也不能拿一份来路不明
 * 或被回滚的配置去连 RPC、去决定要不要强制升级（安全评审 N3）。
 */
async function assertAuthentic(body: string, header: string): Promise<void> {
  const signerAddress = appRuntime.bootstrapSignerAddress;
  if (signerAddress === "") return; // 这个租户还没开签名
  if (header === "") {
    if (!REQUIRE_BOOTSTRAP_SIGNATURE) return;
    throw new AppError(
      "incompatible_response",
      "The server did not sign its configuration",
      false,
    );
  }
  verifyBootstrapSignature({ body, header, signerAddress });
}

export async function loadBootstrap(
  locale: SupportedLocale,
  signal?: AbortSignal,
): Promise<BootstrapSnapshot> {
  // 可选携带安装身份：服务端验明凭证后才让这台设备参与灰度匹配（设计
  // canary-release-allowlist-2026-09-11 §8.1）。还没注册过就不带，
  // bootstrap 照常返回配置——它是启动门禁，不能因为身份问题失败
  //
  // 用 getText 而不是 get：验签验的是**收到的那串原始字节**，必须在 JSON.parse
  // 之前拿到手。先解析再验等于给自己留一个"解析过程改写了什么"的缺口。
  const response = await apiClient.getText(
    `/v1/mobile/bootstrap?locale=${encodeURIComponent(locale)}`,
    // 60 KB 的下发在弱网下 8 秒会误判超时（真机实测过一次"暂时无法获取远程配置"）
    {
      signal,
      timeoutMs: BOOTSTRAP_TIMEOUT_MS,
      headers: await installationAuthorization(),
    },
  );
  await assertAuthentic(
    response.text,
    response.headers.get("x-bootstrap-signature") ?? "",
  );
  const parsed = bootstrapSchema.safeParse(JSON.parse(response.text));
  if (!parsed.success) {
    throw new AppError(
      "incompatible_response",
      "The server response does not match the mobile contract",
      false,
      response.headers.get("x-request-id") ?? undefined,
      undefined,
      { cause: parsed.error },
    );
  }
  const config = parsed.data;
  if (config.issuedAt !== undefined) {
    if (isReplayed(config.issuedAt, await highestIssuedAt()))
      throw new AppError(
        "incompatible_response",
        "The server replayed an older configuration",
        false,
      );
    await rememberIssuedAt(config.issuedAt);
  }
  // 令牌"这次存、下次启动生效"，所以每次都写，不等到真有灰度包。
  // 不 await：setExtraParamAsync 走 expo-updates 自己的执行器，更新正在下载时
  // 会排在它后面。灰度是附加能力，不该让启动门禁等它（函数内部已吞掉所有失败）
  void rememberCanaryToken(config.update.canary?.otaToken ?? null);
  const enriched = await hydrateCachedBranding(
    await applyRemoteLanguagePackage(normalizeConfig(config), signal),
  );
  await AsyncStorage.setItem(
    cacheKey(locale),
    JSON.stringify({
      savedAt: Date.now(),
      config: withoutCanaryToken(enriched),
    }),
  );
  return { config: enriched, source: "remote" };
}
