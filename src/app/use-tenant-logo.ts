import { useColorScheme } from "react-native";
import {
  brandingAssetUrl,
  resolveBrandingVisual,
} from "../core/config/branding-assets";
import { useFoundationRuntime } from "./runtime-context";

/**
 * 租户 logo（来自 RN-Server branding，与启动页同一资源）。
 * 返回 undefined 表示租户没有配置 logo：BrandMark 此时什么都不画，没有内置替身。
 */
export function useTenantLogoUri(): string | undefined {
  const { config, themePreference } = useFoundationRuntime();
  const system = useColorScheme();
  const branding = config.branding;
  if (!branding?.enabled) return undefined;
  const theme: "light" | "dark" =
    themePreference === "system"
      ? system === "dark"
        ? "dark"
        : "light"
      : themePreference;
  const visual = resolveBrandingVisual(branding.launch.visuals, theme);
  return visual.logo
    ? (visual.logo.localFileUrl ?? brandingAssetUrl(visual.logo))
    : undefined;
}
