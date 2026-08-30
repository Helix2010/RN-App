export type AppTab =
  "home" | "predict" | "positions" | "dex" | "market" | "swap" | "assets";

export function resolveAppShellBack(tab: AppTab): "home" | "consume" {
  return tab === "home" ? "consume" : "home";
}
