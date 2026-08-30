import { useQuery } from "@tanstack/react-query";
import type { SupportedLocale } from "./bootstrap.schema";
import { loadBootstrap } from "./bootstrap-repository";

export function useBootstrap(locale: SupportedLocale) {
  return useQuery({
    queryKey: ["mobile-bootstrap", locale],
    queryFn: ({ signal }) => loadBootstrap(locale, signal),
    // Keep the last verified tenant configuration visible while a new locale
    // is being staged. A failed language request must not replace the whole
    // app with the startup gate.
    placeholderData: (previous) => previous,
    staleTime: 5 * 60 * 1_000,
    gcTime: 24 * 60 * 60 * 1_000,
    retry: false,
  });
}
