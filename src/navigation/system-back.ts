export type RootRouteName =
  | "AppShell"
  | "Profile"
  | "UpdateCenter"
  | "Settings"
  | "LanguageSettings"
  | "AppearanceSettings"
  | "PredictEvent"
  | "DexToken"
  | "SwapHistory"
  | "Transfer"
  | "AccountDetail"
  | "NotificationSettings"
  | "About"
  | "SecurityCenter";

export function resolveSystemBack(
  routeName: RootRouteName | undefined,
  canGoBack: boolean,
  updateLocked: boolean,
): "navigate" | "consume" | "bubble" {
  if (routeName === "UpdateCenter" && updateLocked) return "consume";
  if (routeName && routeName !== "AppShell" && canGoBack) return "navigate";
  return "bubble";
}
