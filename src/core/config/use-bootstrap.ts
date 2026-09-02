import { useQuery } from "@tanstack/react-query";
import { loadBootstrap, type BootstrapSnapshot } from "./bootstrap-repository";
import { applyDeliveredWalletConfig } from "../wallet/config/wallet-runtime-config";
import type { SupportedLocale } from "./bootstrap.schema";

/**
 * "收到一份 bootstrap" = 解析通过 + 运行时配置已应用。钱包运行时配置是模块级状态，
 * 在这里随数据一起应用，业务界面就不可能在它应用之前拿到 query.data 而先渲染一帧。
 */
export async function bootstrapQueryFn(
  locale: SupportedLocale,
  signal?: AbortSignal,
): Promise<BootstrapSnapshot> {
  const snapshot = await loadBootstrap(locale, signal);
  applyDeliveredWalletConfig(snapshot.config.wallet);
  return snapshot;
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
    retry: false,
  });
}
