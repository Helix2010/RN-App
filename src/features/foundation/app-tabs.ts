import type { AppTab } from "./app-shell-back";
import type { AppIconName } from "../../design-system";

export type AppTabDefinition = {
  key: AppTab;
  labelKey: string;
  icon: AppIconName;
};

export type AppModules = { predict: boolean; dex: boolean };

/** Wallet-only：两个业务模块都没开 */
export function isWalletOnly(modules: AppModules): boolean {
  return !modules.predict && !modules.dex;
}

/**
 * 底部导航。四种模块组合各有一套，`00`（Wallet-only）是其中一种正式形态。
 *
 * `00` 下首页和资产讲的是同一件事——没有业务模块时，"总览"就是"资产"——
 * 所以壳层直接以资产为主页，另外两格给记录与我的，而不是留两个内容重复的页签。
 */
export function buildAppTabs(modules: AppModules): AppTabDefinition[] {
  if (isWalletOnly(modules)) {
    return [
      { key: "assets", labelKey: "nav.assets", icon: "wallet-outline" },
      { key: "records", labelKey: "nav.records", icon: "history" },
      {
        key: "profile",
        labelKey: "nav.profile",
        icon: "account-circle-outline",
      },
    ];
  }
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

/**
 * 壳层的主页签：返回键回到这里，内容不可达时也退回这里。
 *
 * 刻意从 `buildAppTabs` 取第一项而不是写死 `"home"`——`00` 下根本没有 home 页签，
 * 写死会让壳层渲染一个底栏上不存在的页面。
 */
export function defaultAppTab(modules: AppModules): AppTab {
  const [first] = buildAppTabs(modules);
  if (!first) throw new Error("buildAppTabs must always return a tab");
  return first.key;
}

/**
 * 这个内容在当前模块组合下能不能显示。
 *
 * 和 `buildAppTabs` 不是一回事：`positions` / `market` / `swap` 在双开时不是底部
 * 页签，但仍是可达内容（嵌在 predict / dex 之下）。
 */
export function isAppContentAvailable(
  tab: AppTab,
  modules: AppModules,
): boolean {
  if (tab === "assets") return true;
  // 首页只在有业务模块时存在；Wallet-only 的主页是资产
  if (tab === "home") return !isWalletOnly(modules);
  // 记录与我的只在 Wallet-only 时进壳层；其它组合里它们是栈内页面
  if (tab === "records" || tab === "profile") return isWalletOnly(modules);
  if (tab === "predict" || tab === "positions") return modules.predict;
  return modules.dex;
}

export function resolveBottomTab(content: AppTab, modules: AppModules): AppTab {
  if (modules.predict && modules.dex) {
    if (content === "positions") return "predict";
    if (content === "market" || content === "swap") return "dex";
  }
  return content;
}
