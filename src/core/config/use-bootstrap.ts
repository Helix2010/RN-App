import { useQuery } from "@tanstack/react-query";
import type { SupportedLocale } from "./bootstrap.schema";
import { loadBootstrap } from "./bootstrap-repository";

export function useBootstrap(locale: SupportedLocale) {
  return useQuery({
    queryKey: ["mobile-bootstrap", locale],
    queryFn: ({ signal }) => loadBootstrap(locale, signal),
    staleTime: 5 * 60 * 1_000,
    gcTime: 24 * 60 * 60 * 1_000,
    retry: false,
  });
}
