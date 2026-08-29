export type RootRouteName = "AppShell" | "UpdateCenter" | "Settings";

export function resolveSystemBack(
  routeName: RootRouteName | undefined,
  canGoBack: boolean,
  updateLocked: boolean,
): "navigate" | "consume" | "bubble" {
  if (routeName === "UpdateCenter" && updateLocked) return "consume";
  if ((routeName === "Settings" || routeName === "UpdateCenter") && canGoBack)
    return "navigate";
  return "bubble";
}
