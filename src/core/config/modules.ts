import type { BootstrapConfig } from "./bootstrap.schema";

/** 业务模块开关。两个独立开关，四种组合都是正式形态。 */
export type AppModules = BootstrapConfig["modules"];

/**
 * Wallet-only（`00`）：两个业务模块都没开。
 *
 * 这是一个可独立售卖的纯钱包产品形态，不是异常或空状态。判定放在 core 而不是
 * 某个 feature 里——壳层、资产页和管理端预览都要用它，feature 之间不互相深层导入。
 */
export function isWalletOnly(modules: AppModules): boolean {
  return !modules.predict && !modules.dex;
}
