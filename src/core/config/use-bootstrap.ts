import { useQuery } from "@tanstack/react-query";
import {
  loadBootstrap,
  loadCachedBootstrap,
  MAX_CACHE_ENTRY_AGE_MS,
  type BootstrapSnapshot,
} from "./bootstrap-repository";
import { applyDeliveredWalletConfig } from "../wallet/config/wallet-runtime-config";
import { applyDeliveredServices } from "../predict-platform/config";
import { AppError } from "../network/app-error";
import type { SupportedLocale } from "./bootstrap.schema";

/** 请求失败后还要再试几次；每次之间等多久（指数退避，封顶 4 秒）。 */
const RETRY_LIMIT = 2;
const RETRY_BASE_MS = 800;
const RETRY_MAX_MS = 4_000;

/**
 * "收到一份 bootstrap" = 解析通过 + 运行时配置已应用。钱包运行时配置是模块级状态，
 * 在这里随数据一起应用，业务界面就不可能在它应用之前拿到 query.data 而先渲染一帧。
 */
export async function bootstrapQueryFn(
  locale: SupportedLocale,
  signal?: AbortSignal,
): Promise<BootstrapSnapshot> {
  const snapshot = await loadBootstrap(locale, signal).catch(
    async (error: unknown) => {
      // 一次请求失败不该让一台配置齐全的设备打不开。缓存里那份是上一次成功下发、
      // 过了同一套 schema 的真实配置——用它启动，远好过把用户挡在"配置连接失败"
      // 那一屏后面等他自己点重连（2026-09-12 线上现象）。
      //
      // 只认一天内的：bootstrap 同时是强制升级和下线一条链的通道，放行一份更老的
      // 配置等于让这些决定到不了这台设备。长期离线仍然进不去业务页，这是有意的。
      //
      // 取消不算失败：locale 切换会中止上一发请求，那时候不要退回缓存。
      if (signal?.aborted) throw error;
      const cached = await loadCachedBootstrap(
        locale,
        MAX_CACHE_ENTRY_AGE_MS,
      ).catch(() => null);
      if (!cached) throw error;
      return { config: cached, source: "cache" } as const;
    },
  );
  applyDeliveredWalletConfig(snapshot.config.wallet);
  applyDeliveredServices(snapshot.config.services);
  return snapshot;
}

/**
 * 只重试传输层失败（网络不可达、超时、5xx、429）。解析失败、4xx 是确定性的，
 * 重试只会把用户多晾几秒，结论一样。
 */
export function shouldRetryBootstrap(count: number, error: unknown): boolean {
  if (count >= RETRY_LIMIT) return false;
  return error instanceof AppError && error.retryable;
}

export function bootstrapRetryDelay(count: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** count, RETRY_MAX_MS);
}

export function useBootstrap(locale: SupportedLocale) {
  return useQuery({
    queryKey: ["mobile-bootstrap", locale],
    queryFn: ({ signal }) => bootstrapQueryFn(locale, signal),
    // Keep the last verified tenant configuration visible while a new locale
    // is being staged. A failed language request must not replace the whole
    // app with the startup gate.
    placeholderData: (previous) => previous,
    staleTime: 5 * 60 * 1_000,
    gcTime: 24 * 60 * 60 * 1_000,
    retry: shouldRetryBootstrap,
    retryDelay: bootstrapRetryDelay,
  });
}
