import { z } from "zod";
import type { PredictServiceConfig } from "../config/bootstrap.schema";
import type { KeyValueStorage } from "../gateways/types";
import { platformHosts, platformRequest } from "./tenant-client";

/**
 * 平台协议：`GET {gamma}/agreements`（`gamma-service/internal/handlers/agreements.go`）。
 *
 * 字段与 `public_info.go` 的 `publicInfoAgreement` 一致；`titleTranslation` /
 * `contentTranslation` / `externalUrl` 是按语言分键的 JSON 字符串（实测 dev：
 * `{"en": …, "zh": …}`），取法照搬 user-dapp 的 `pickTranslation`。
 * 接受记录与网页版一样只存本机（`useAgreementAcceptance.ts`）：按 scopeId 记
 * `{type: version}`，`required` 且版本对不上的就是待接受。
 */

const agreementSchema = z.object({
  type: z.string().min(1),
  titleTranslation: z.string(),
  version: z.string().min(1),
  contentTranslation: z.string().optional(),
  externalUrl: z.string().optional(),
  required: z.boolean(),
  sortOrder: z.number(),
});
export type PlatformAgreement = z.infer<typeof agreementSchema>;

export async function fetchAgreements(
  service: PredictServiceConfig,
): Promise<PlatformAgreement[]> {
  const hosts = platformHosts(service);
  const result = await platformRequest({
    url: `${hosts.gamma}/agreements`,
    tenantDomain: service.domain,
    schema: z.object({ agreements: z.array(agreementSchema) }),
  });
  return [...result.agreements].sort((a, b) => a.sortOrder - b.sortOrder);
}

function normalizeLocaleKey(key: string): string {
  return key.trim().toLowerCase().replace(/_/g, "-");
}

/**
 * 从按语言分键的 JSON 字符串里挑当前语言：完整 locale → 语言前缀 → 以该前缀开头的键
 * → `default` → `en` → 第一个非空值。不是 JSON 的原样返回（externalUrl 可能就是一个 URL）。
 */
export function pickAgreementText(
  raw: string | undefined,
  locale: string,
): string | undefined {
  if (!raw) return undefined;
  let map: Record<string, string>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return raw.trim() || undefined;
    map = parsed as Record<string, string>;
  } catch {
    return raw.trim() || undefined;
  }
  const entries = Object.entries(map)
    .filter(([, value]) => typeof value === "string" && value.trim() !== "")
    .map(([key, value]) => [normalizeLocaleKey(key), value.trim()] as const);
  const want = normalizeLocaleKey(locale);
  const short = want.split("-")[0] ?? want;
  const exact = (target: string) =>
    entries.find(([key]) => key === target)?.[1];
  const prefixed = (target: string) =>
    entries.find(([key]) => key.startsWith(`${target}-`))?.[1];
  return (
    exact(want) ??
    exact(short) ??
    prefixed(short) ??
    exact("default") ??
    exact("en") ??
    prefixed("en") ??
    entries[0]?.[1]
  );
}

type AcceptedAgreements = Record<string, string>;

export function pendingAgreements(
  agreements: PlatformAgreement[],
  accepted: AcceptedAgreements,
): PlatformAgreement[] {
  return agreements.filter(
    (item) => item.required && accepted[item.type] !== item.version,
  );
}

const ACCEPTANCE_KEY_PREFIX = "foundation.predict.agreements-accepted.v1";

/** 本机的接受记录，按 scopeId 分开；换平台不会带过去。 */
export class AgreementAcceptanceStore {
  constructor(private readonly storage: KeyValueStorage) {}

  private key(scopeId: string): string {
    return `${ACCEPTANCE_KEY_PREFIX}.${scopeId.toLowerCase()}`;
  }

  async load(scopeId: string): Promise<AcceptedAgreements> {
    const raw = await this.storage.getItem(this.key(scopeId));
    if (!raw) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return {};
      return Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    } catch {
      return {};
    }
  }

  async accept(
    scopeId: string,
    agreements: PlatformAgreement[],
  ): Promise<AcceptedAgreements> {
    const current = await this.load(scopeId);
    for (const item of agreements) current[item.type] = item.version;
    await this.storage.setItem(this.key(scopeId), JSON.stringify(current));
    return current;
  }
}
