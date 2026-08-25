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
  primary: "#3157D5",
  onPrimary: "#FFFFFF",
  background: "#F4F7FB",
  surface: "#FFFFFF",
  surfaceVariant: "#EAF0F8",
  text: "#101828",
  textMuted: "#5A687C",
  border: "#D5DDE9",
  success: "#147A50",
  warning: "#9A5C00",
  danger: "#B42318",
  info: "#2962A3",
  pricePositive: "#0E8A5F",
  priceNegative: "#D03C45",
  risk: "#7A4D00",
  focus: "#7293FF",
  backdrop: "rgba(11, 18, 32, 0.56)",
};

const embeddedDark: SemanticPalette = {
  primary: "#AFC6FF",
  onPrimary: "#082B78",
  background: "#0B1220",
  surface: "#121C2D",
  surfaceVariant: "#1D2A3E",
  text: "#F0F4FA",
  textMuted: "#A9B7CA",
  border: "#35445A",
  success: "#61D6A3",
  warning: "#F4BD68",
  danger: "#FFB4AB",
  info: "#A8CAFF",
  pricePositive: "#5CDBA8",
  priceNegative: "#FF7B86",
  risk: "#F4BD68",
  focus: "#AFC6FF",
  backdrop: "rgba(0, 0, 0, 0.72)",
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
