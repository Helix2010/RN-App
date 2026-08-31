import type { PropsWithChildren } from "react";
import { useMemo } from "react";
import { useColorScheme } from "react-native";
import { TamaguiProvider, Theme } from "tamagui";
import {
  usePreferencesStore,
  type ThemePreference,
} from "../core/preferences/preferences-store";
import type {
  BootstrapConfig,
  SemanticPalette,
} from "../core/config/bootstrap.schema";
import { createFoundationTamaguiConfig } from "./tamagui.config";

type Props = PropsWithChildren<{
  config: BootstrapConfig;
  preference: ThemePreference;
}>;

export function FoundationThemeProvider({
  config,
  preference,
  children,
}: Props) {
  const systemScheme = useColorScheme();
  const effectivePreference = config.theme.allowUserOverride
    ? preference
    : "system";
  const resolved: "light" | "dark" =
    effectivePreference === "system"
      ? systemScheme === "dark"
        ? "dark"
        : "light"
      : effectivePreference;
  const colorScheme = usePreferencesStore((state) => state.colorScheme);
  const swap = (palette: SemanticPalette): SemanticPalette =>
    colorScheme === "red-up"
      ? {
          ...palette,
          pricePositive: palette.priceNegative,
          priceNegative: palette.pricePositive,
        }
      : palette;
  const tamaguiConfig = useMemo(
    () =>
      createFoundationTamaguiConfig(
        swap(config.theme.light),
        swap(config.theme.dark),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.theme.dark, config.theme.light, colorScheme],
  );

  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme={resolved}>
      <Theme name={resolved}>{children}</Theme>
    </TamaguiProvider>
  );
}
