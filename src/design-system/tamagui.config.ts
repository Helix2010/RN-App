import { createAnimations } from "@tamagui/animations-react-native";
import { defaultConfig } from "@tamagui/config/v5";
import { createTamagui } from "tamagui";
import type { SemanticPalette } from "../core/config/bootstrap.schema";

const animations = createAnimations({
  fast: { damping: 24, mass: 0.7, stiffness: 300 },
  medium: { damping: 20, mass: 0.9, stiffness: 220 },
  slow: { damping: 18, mass: 1, stiffness: 140 },
});

const embeddedLight: SemanticPalette = {
  primary: "#F0B90B",
  onPrimary: "#181A20",
  background: "#F5F5F5",
  surface: "#FFFFFF",
  surfaceVariant: "#F0F1F2",
  text: "#1E2329",
  textMuted: "#707A8A",
  border: "#EAECEF",
  success: "#0ECB81",
  warning: "#D0980B",
  danger: "#F6465D",
  info: "#3861FB",
  pricePositive: "#0ECB81",
  priceNegative: "#F6465D",
  risk: "#D0980B",
  focus: "#FCD535",
  backdrop: "rgba(24,26,32,0.56)",
};

const embeddedDark: SemanticPalette = {
  primary: "#F0B90B",
  onPrimary: "#181A20",
  background: "#0B0E11",
  surface: "#181A20",
  surfaceVariant: "#23262D",
  text: "#EAECEF",
  textMuted: "#848E9C",
  border: "#2B3139",
  success: "#0ECB81",
  warning: "#F0B90B",
  danger: "#F6465D",
  info: "#4A7DFF",
  pricePositive: "#0ECB81",
  priceNegative: "#F6465D",
  risk: "#F0B90B",
  focus: "#FCD535",
  backdrop: "rgba(0,0,0,0.72)",
};

function mapTheme(palette: SemanticPalette) {
  return {
    background: palette.background,
    backgroundHover: palette.surfaceVariant,
    backgroundPress: palette.surfaceVariant,
    backgroundFocus: palette.surfaceVariant,
    backgroundStrong: palette.surface,
    backgroundTransparent: "transparent",
    color: palette.text,
    colorHover: palette.text,
    colorPress: palette.text,
    colorFocus: palette.text,
    colorTransparent: "transparent",
    borderColor: palette.border,
    borderColorHover: palette.focus,
    borderColorPress: palette.primary,
    borderColorFocus: palette.focus,
    placeholderColor: palette.textMuted,
    outlineColor: palette.focus,
    shadowColor: palette.backdrop,
    primary: palette.primary,
    onPrimary: palette.onPrimary,
    surface: palette.surface,
    surfaceVariant: palette.surfaceVariant,
    textMuted: palette.textMuted,
    success: palette.success,
    warning: palette.warning,
    danger: palette.danger,
    info: palette.info,
    pricePositive: palette.pricePositive,
    priceNegative: palette.priceNegative,
    risk: palette.risk,
    focus: palette.focus,
    backdrop: palette.backdrop,
  };
}

export function createFoundationTamaguiConfig(
  light: SemanticPalette = embeddedLight,
  dark: SemanticPalette = embeddedDark,
) {
  return createTamagui({
    ...defaultConfig,
    animations,
    settings: {
      ...defaultConfig.settings,
      onlyAllowShorthands: false,
      styleCompat: "react-native",
      allowedStyleValues: "somewhat-strict",
    },
    themes: {
      ...defaultConfig.themes,
      light: mapTheme(light),
      dark: mapTheme(dark),
    },
  });
}

export const tamaguiConfig = createFoundationTamaguiConfig();
export type FoundationTamaguiConfig = typeof tamaguiConfig;

declare module "tamagui" {
  // Tamagui uses an empty interface extension as its supported module augmentation API.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface TamaguiCustomConfig extends FoundationTamaguiConfig {}
}
