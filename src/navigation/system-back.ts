export type RootRouteName =
  | "AppShell"
  | "Profile"
  | "UpdateCenter"
  | "Settings"
  | "LanguageSettings"
  | "AppearanceSettings"
  | "PredictEvent"
  | "PredictOrder"
  | "PredictSettlement"
  | "DexToken"
  | "Swap"
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
