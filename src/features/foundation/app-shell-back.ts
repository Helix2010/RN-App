export type AppTab = "home" | "assets" | "profile";

export function resolveAppShellBack(tab: AppTab): "home" | "consume" {
  return tab === "home" ? "consume" : "home";
}
