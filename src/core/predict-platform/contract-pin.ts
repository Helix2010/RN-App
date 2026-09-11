import type { KeyValueStorage } from "../gateways/types";
import type { PredictServiceConfig } from "../config/bootstrap.schema";
import type { PlatformContracts } from "./public-info";

/**
 * 平台合约地址的 TOFU 钉住（安全评审 N3）。
 *
 * 预测平台的合约地址是运行时从 `GET {gamma}/public-info` 取的，而那条链路的
 * 真实性只到 TLS 为止——bootstrap 没有签名，域名本身也来自 bootstrap。换句话说，
 * 能改配置或能顶替那个域名的人可以把 `collateralToken` / `ctfExchange` 换成
 * 自己的地址，而开通流程会对它做无限额授权。这是评审里 N3 的资金路径部分。
 *
 * 终态方案（把地址编译期固化进 tenant.json，平台换合约就必须发原生版）需要一个
 * 产品决策。在那之前，先钉住"第一次成功看到的那一组"：地址集合再变就拒绝启用，
 * 而不是照单全收。这不需要任何决策，也不会让今天正常的设备变慢或变坏。
 *
 * **失败是有意 fail closed 的**：地址变了就不能继续签授权。平台真的迁移合约时，
 * 走 `CONTRACT_PIN_EPOCH`——改这个常量并发一次 App/OTA，所有设备重新 TOFU。
 * 要求"改代码才能放行"正是这条防线的意义，不要改成静默接受或自动覆盖。
 */

/**
 * 钉住记录的世代。平台合法迁移合约时 +1 并发版，所有设备重新记一次。
 * 不要为了让某台设备恢复而在本地清掉记录——那等于把这条防线关掉。
 */
const CONTRACT_PIN_EPOCH = 1;

const PIN_PREFIX = "predict.platform.contracts";

export class PredictPlatformContractsChangedError extends Error {
  constructor(readonly changed: string[]) {
    super(
      `predict platform contracts changed since they were first pinned: ${changed.join(", ")}`,
    );
    this.name = "PredictPlatformContractsChangedError";
  }
}

/**
 * 钉住记录按 (domain, scopeId, chain) 分键——和 `contextFor()` 的缓存键一致。
 * 换租户、换链、换平台域名都是另一组合约，各钉各的。
 */
export function contractPinKey(service: PredictServiceConfig): string {
  return `${PIN_PREFIX}.${service.domain}.${service.scopeId}.${service.chain}.v${CONTRACT_PIN_EPOCH}`;
}

/**
 * 把一组合约拍平成可比对的形状：地址一律小写（平台可能换 checksum 大小写，
 * 那不是变化），精度一并纳入——USDW 的 decimals 变了，同一个数字就是另一笔钱。
 * 缺省的可选适配器记成 `null`，"从有变没有"同样要被看见。
 */
export function contractPinRecord(
  contracts: PlatformContracts,
): Record<string, string | number | null> {
  const record: Record<string, string | number | null> = {};
  for (const [key, value] of Object.entries(contracts).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  ))
    record[key] =
      typeof value === "string"
        ? value.toLowerCase()
        : typeof value === "number"
          ? value
          : null;
  return record;
}

/** 两份记录里不一致的字段名（含只在一边出现的）。 */
export function contractPinDiff(
  pinned: Record<string, string | number | null>,
  current: Record<string, string | number | null>,
): string[] {
  const keys = new Set([...Object.keys(pinned), ...Object.keys(current)]);
  return [...keys].filter((key) => pinned[key] !== current[key]).sort();
}

/**
 * 第一次成功取到合约就记下来；之后每次都比对。不一致抛
 * `PredictPlatformContractsChangedError`，调用方据此拒绝启用/下单。
 *
 * 存储里的记录读不出来或不是合法 JSON 时，当成"没钉过"重新钉：这个键只影响
 * 这一条防线，把损坏的记录当成不一致会让用户永久卡住，而重新钉住至少恢复到
 * "从现在起地址不能再变"。
 */
export async function assertPinnedPlatformContracts(
  storage: KeyValueStorage,
  service: PredictServiceConfig,
  contracts: PlatformContracts,
): Promise<void> {
  const key = contractPinKey(service);
  const current = contractPinRecord(contracts);
  const raw = await storage.getItem(key);
  if (raw !== null) {
    let pinned: Record<string, string | number | null> | null = null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        pinned = parsed as Record<string, string | number | null>;
    } catch {
      pinned = null;
    }
    if (pinned) {
      const changed = contractPinDiff(pinned, current);
      if (changed.length > 0)
        throw new PredictPlatformContractsChangedError(changed);
      return;
    }
  }
  await storage.setItem(key, JSON.stringify(current));
}
