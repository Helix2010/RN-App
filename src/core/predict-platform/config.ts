import type { PredictServiceConfig } from "../config/bootstrap.schema";

/**
 * 服务端下发的预测平台关联（`services.predict`）。
 *
 * 和钱包运行时配置一样**只有服务端这一条来源**：没下发就是"没有关联"，取用方拿到
 * `PredictServiceNotConfiguredError`，界面如实显示不可用——没有内置默认，也没有演示
 * 替身。三个字段任一变化都视为换了平台：订阅者（凭证存储）要把旧平台的凭证清掉。
 */

export class PredictServiceNotConfiguredError extends Error {
  constructor() {
    super("the prediction platform is not configured for this tenant");
    this.name = "PredictServiceNotConfiguredError";
  }
}

type Listener = (
  next: PredictServiceConfig | null,
  previous: PredictServiceConfig | null,
) => void;

let delivered: PredictServiceConfig | null = null;
const listeners = new Set<Listener>();

function same(
  a: PredictServiceConfig | null,
  b: PredictServiceConfig | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.domain === b.domain && a.scopeId === b.scopeId && a.chain === b.chain
  );
}

export function applyDeliveredServices(services: {
  predict?: PredictServiceConfig;
}): void {
  const next = services.predict ?? null;
  const previous = delivered;
  if (same(previous, next)) return;
  delivered = next;
  for (const listener of listeners) listener(next, previous);
}

/** 关联变化时通知（换平台 / 关闭）。返回取消订阅函数。 */
export function onPredictServiceChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isPredictServiceConfigured(): boolean {
  return delivered !== null;
}

/** 当前的平台关联；没下发即抛错，调用方不该在没有关联时走到这里。 */
export function predictService(): PredictServiceConfig {
  if (!delivered) throw new PredictServiceNotConfiguredError();
  return delivered;
}

/** 仅供测试重置模块级状态。 */
export function resetDeliveredServices(): void {
  delivered = null;
}
