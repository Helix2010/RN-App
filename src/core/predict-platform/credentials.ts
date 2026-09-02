import type { PredictServiceConfig } from "../config/bootstrap.schema";
import type { SecureStorePort } from "../wallet/vault/ports";
import type { ClobCredentials } from "./clob-auth";

/**
 * 平台凭证的保管：gamma JWT、CLOB 密钥、Safe 地址。
 *
 * 键按 `域名 + scopeId + 地址` 分开：换平台、换租户、换钱包都不会拿错凭证。
 * 存系统安全存储；登出 / 切换地址 / 平台关联变化 / 卸载重装后首次启动都要清。
 * 这里不做任何"过期了就先用着"的事：能不能用由 `jwtUsable` 判断，不能用就重新登录。
 */

export type PredictCredentials = {
  jwt?: string;
  clob?: ClobCredentials;
  safe?: string;
};

const INDEX_KEY = "foundation.predict.credentials.index.v1";

function keyFor(service: PredictServiceConfig, address: string): string {
  return `foundation.predict.${service.domain}.${service.scopeId}.${address.toLowerCase()}.v1`;
}

export class PredictCredentialStore {
  constructor(private readonly secure: SecureStorePort) {}

  async load(
    service: PredictServiceConfig,
    address: string,
  ): Promise<PredictCredentials> {
    const raw = await this.secure.get(keyFor(service, address));
    if (!raw) return {};
    try {
      return JSON.parse(raw) as PredictCredentials;
    } catch {
      // 存储里的内容坏了：当没有，重新建立；不留一份读不出来的
      await this.secure.remove(keyFor(service, address));
      return {};
    }
  }

  async save(
    service: PredictServiceConfig,
    address: string,
    patch: Partial<PredictCredentials>,
  ): Promise<PredictCredentials> {
    const current = await this.load(service, address);
    const next = { ...current, ...patch };
    const key = keyFor(service, address);
    await this.secure.set(key, JSON.stringify(next));
    await this.remember(key);
    return next;
  }

  async clear(service: PredictServiceConfig, address: string): Promise<void> {
    const key = keyFor(service, address);
    await this.secure.remove(key);
    await this.forget(key);
  }

  /** 清掉所有平台凭证（平台关联变化、登出、重装后首次启动）。 */
  async clearAll(): Promise<void> {
    const keys = await this.index();
    for (const key of keys) await this.secure.remove(key);
    await this.secure.remove(INDEX_KEY);
  }

  private async index(): Promise<string[]> {
    const raw = await this.secure.get(INDEX_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  }

  private async remember(key: string): Promise<void> {
    const keys = await this.index();
    if (!keys.includes(key))
      await this.secure.set(INDEX_KEY, JSON.stringify([...keys, key]));
  }

  private async forget(key: string): Promise<void> {
    const keys = await this.index();
    await this.secure.set(
      INDEX_KEY,
      JSON.stringify(keys.filter((item) => item !== key)),
    );
  }
}
