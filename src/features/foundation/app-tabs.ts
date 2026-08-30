import type { AppTab } from "./app-shell-back";

export type AppTabDefinition = {
  key: AppTab;
  labelKey: string;
  symbol: string;
};

export function buildAppTabs(modules: {
  predict: boolean;
  dex: boolean;
}): AppTabDefinition[] {
  const tabs: AppTabDefinition[] = [
    { key: "home", labelKey: "nav.home", symbol: "⌂" },
  ];
  if (modules.predict) {
    tabs.push({ key: "predict", labelKey: "nav.predict", symbol: "◒" });
    if (!modules.dex)
      tabs.push({ key: "positions", labelKey: "nav.positions", symbol: "◉" });
  }
  if (modules.dex) {
    if (modules.predict) {
      tabs.push({ key: "dex", labelKey: "nav.dex", symbol: "◇" });
    } else {
      tabs.push({ key: "market", labelKey: "nav.market", symbol: "▥" });
      tabs.push({ key: "swap", labelKey: "nav.swap", symbol: "⇄" });
    }
  }
  tabs.push({ key: "assets", labelKey: "nav.assets", symbol: "▣" });
  return tabs;
}
