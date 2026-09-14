import { logEvent } from "../../../core/diagnostics/log-buffer";
import { CHAINS, type ChainId } from "../../../core/gateways/types";
import type { WalletGateway } from "./gateway";

/**
 * 钱包操作失败进诊断日志（设计 diagnostic-report-2026-09-14 §4.2）。
 *
 * 只记三样：**操作名、错误类名、链 ID**。钱包域的错误都是具名错误类，类名就是错误码。
 *
 * **绝不记错误消息**：`UnsignableTransactionError` 的消息是「收款地址不合法：0x…」，
 * 别的错误也可能带金额或交易内容。参数同理——只从固定的几种形状里取链 ID，
 * 地址、金额、签名内容一概不碰。
 */

/** 属于正常流程的"错误"：UI 据此转去建钱包、弹口令框，或者是用户自己取消的。 */
const FLOW_ERRORS = new Set([
  "WalletNotProvisionedError",
  "WalletAuthRequiredError",
  "WalletPassphraseRequiredError",
  "WalletConnectRejectedError",
]);

function isChainId(value: unknown): value is ChainId {
  return typeof value === "string" && Object.hasOwn(CHAINS, value);
}

/** 只认三种形状：裸链 ID、带 `chain` 的对象（TokenRef）、带 `token.chain` 的对象（SendRequest）。 */
function chainOf(args: unknown[]): ChainId | undefined {
  for (const arg of args) {
    if (isChainId(arg)) return arg;
    if (!arg || typeof arg !== "object") continue;
    const record = arg as { chain?: unknown; token?: { chain?: unknown } };
    if (isChainId(record.chain)) return record.chain;
    const tokenChain = record.token?.chain;
    if (isChainId(tokenChain)) return tokenChain;
  }
  return undefined;
}

/** 类名也要验形状：`error.name` 是可写属性，谁都能往里塞一句话。 */
function errorNameOf(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : "unknown";
}

function recordFailure(op: string, args: unknown[], error: unknown): void {
  const name = errorNameOf(error);
  const chain = chainOf(args);
  logEvent(
    FLOW_ERRORS.has(name) ? "info" : "error",
    "wallet",
    "operation failed",
    {
      op,
      error: name,
      ...(chain ? { chain } : {}),
    },
  );
}

/**
 * 给钱包网关套一层失败记录。调用方拿到的仍然是同一个接口，行为不变。
 *
 * 方法以**原对象**为 `this` 调用，不是以 Proxy：否则网关内部方法互相调用（`send` 里的
 * `this.quote()`）也会经过这一层，一次失败被记成好几条，日志里的操作名就对不上用户做的事了。
 */
export function withWalletDiagnostics(gateway: WalletGateway): WalletGateway {
  return new Proxy(gateway, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property);
      if (typeof value !== "function" || typeof property !== "string")
        return value;
      const method = value as (...args: unknown[]) => unknown;
      return (...args: unknown[]): unknown => {
        let result: unknown;
        try {
          result = method.apply(target, args);
        } catch (error) {
          recordFailure(property, args, error);
          throw error;
        }
        if (result instanceof Promise)
          return result.catch((error: unknown) => {
            recordFailure(property, args, error);
            throw error;
          });
        return result;
      };
    },
  });
}
