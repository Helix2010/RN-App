import type { PropsWithChildren } from "react";
import { useMemo } from "react";
import { useColorScheme } from "react-native";
import { TamaguiProvider, Theme } from "tamagui";
import type { BootstrapConfig } from "../core/config/bootstrap.schema";
import type { ThemePreference } from "../core/preferences/preferences-store";
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
  const tamaguiConfig = useMemo(
    () => createFoundationTamaguiConfig(config.theme.light, config.theme.dark),
    [config.theme.dark, config.theme.light],
  );

  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme={resolved}>
      <Theme name={resolved}>{children}</Theme>
    </TamaguiProvider>
  );
}
