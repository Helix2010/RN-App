import type { AppTab } from "./app-shell-back";
import type { AppIconName } from "../../design-system";

export type AppTabDefinition = {
  key: AppTab;
  labelKey: string;
  icon: AppIconName;
};

export function buildAppTabs(modules: {
  predict: boolean;
  dex: boolean;
}): AppTabDefinition[] {
  const tabs: AppTabDefinition[] = [
    { key: "home", labelKey: "nav.home", icon: "home-outline" },
  ];
  if (modules.predict) {
    tabs.push({
      key: "predict",
      labelKey: "nav.predict",
      icon: "chart-timeline-variant",
    });
    if (!modules.dex)
      tabs.push({
        key: "positions",
        labelKey: "nav.positions",
        icon: "chart-box-outline",
      });
  }
  if (modules.dex) {
    if (modules.predict) {
      tabs.push({ key: "dex", labelKey: "nav.dex", icon: "swap-horizontal" });
    } else {
      tabs.push({ key: "market", labelKey: "nav.market", icon: "chart-line" });
      tabs.push({ key: "swap", labelKey: "nav.swap", icon: "swap-horizontal" });
    }
  }
  tabs.push({ key: "assets", labelKey: "nav.assets", icon: "wallet-outline" });
  return tabs;
}

export function isAppContentAvailable(
  tab: AppTab,
  modules: { predict: boolean; dex: boolean },
): boolean {
  if (tab === "home" || tab === "assets") return true;
  if (tab === "predict" || tab === "positions") return modules.predict;
  return modules.dex;
}

export function resolveBottomTab(
  content: AppTab,
  modules: { predict: boolean; dex: boolean },
): AppTab {
  if (modules.predict && modules.dex) {
    if (content === "positions") return "predict";
    if (content === "market" || content === "swap") return "dex";
  }
  return content;
}
