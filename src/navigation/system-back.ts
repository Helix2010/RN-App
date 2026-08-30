export type RootRouteName =
  | "AppShell"
  | "Profile"
  | "UpdateCenter"
  | "Settings"
  | "LanguageSettings"
  | "AppearanceSettings";

export function resolveSystemBack(
  routeName: RootRouteName | undefined,
  canGoBack: boolean,
  updateLocked: boolean,
): "navigate" | "consume" | "bubble" {
  if (routeName === "UpdateCenter" && updateLocked) return "consume";
  if (
    (routeName === "Profile" ||
      routeName === "Settings" ||
      routeName === "LanguageSettings" ||
      routeName === "AppearanceSettings" ||
      routeName === "UpdateCenter") &&
    canGoBack
  )
    return "navigate";
  return "bubble";
}
