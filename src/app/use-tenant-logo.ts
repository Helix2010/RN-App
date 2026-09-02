import { useColorScheme } from "react-native";
import {
  brandingAssetUrl,
  resolveBrandingVisual,
} from "../core/config/branding-assets";
import { useFoundationRuntime } from "./runtime-context";

/**
 * 租户 logo（来自 RN-Server branding，与启动页同一资源）。
 * 返回 undefined 表示租户没有配置 logo。首页头部目前仍在这种情况下显示内置几何标，
 * 这是尚未按"正式场景原则"处理的替身，不要把它当成设计。
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
