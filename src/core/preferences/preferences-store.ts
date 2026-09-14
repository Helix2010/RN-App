import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { SupportedLocale } from "../config/bootstrap.schema";

export type ThemePreference = "system" | "light" | "dark";
/**
 * 语言偏好：
 * - `default`（默认）：不带语言请求 bootstrap，由服务端给租户在管理端设的回退语言；
 * - `system`：把设备语言交给服务端，租户没开这种语言时服务端同样退回回退语言；
 * - 具体语言码：用户在语言设置里选定的。
 */
export type LocalePreference = "default" | "system" | SupportedLocale;
/** 涨跌颜色：绿涨红跌（默认）/ 红涨绿跌。只交换 pricePositive / priceNegative，Yes/No 语义色不跟随。 */
export type ColorSchemePreference = "green-up" | "red-up";
export type AppLockMethod = "biometric" | "pin";
/**
 * 交易前验证策略（下单 / 兑换 / 划转 / 转出）：
 * - `smart`（默认）：最近 5 分钟内通过过身份验证（解锁应用、上一次操作、签名）就不再弹，
 *   只保留钱包签名那一道验证；
 * - `always`：每次都先弹系统验证，再由签名验证一次（双重验证）；
 * - `off`：不弹（单笔超过大额阈值仍会验证）。
 */
export type TxVerificationPolicy = "smart" | "always" | "off";

/**
 * 设备级偏好（不随账户同步）：语言 / 主题 / 涨跌色 / 应用锁 / 交易前验证 / 大额阈值 / 地址簿白名单。
 * 存储键沿用 foundation.preferences.v1；v2 把布尔 `txConfirm` 升成三态 `txVerification`。
 */
type PreferencesState = {
  theme: ThemePreference;
  locale: LocalePreference;
  colorScheme: ColorSchemePreference;
  appLockEnabled: boolean;
  appLockMethod: AppLockMethod;
  autoLockMinutes: 0 | 1 | 5 | 15;
  /**
   * 一次系统验证之后，密钥库的解锁在内存里还算数多久（秒）。
   *
   * 0 = 每次签名都重新验证。默认 60 秒：评审 0c-2 记的 5 分钟太长——它意味着
   * 拿到一台刚解锁过的设备的人，有五分钟可以随便签名；而开通预测一次要签三笔，
   * 降到 0 又会连弹三次。60 秒是这两头的折中，并且交给用户自己调。
   */
  keyUnlockSeconds: 0 | 60 | 300 | 900;
  txVerification: TxVerificationPolicy;
  largeAmountThresholdUsd: number;
  sendWhitelistOnly: boolean;
  /**
   * 崩溃后自动上报（设计 diagnostic-report-2026-09-14 §4.6 第 2 道闸）。null = 没改过，
   * 跟随租户的 features.crashAutoReport；改过之后以用户的为准，关了就是关了。
   */
  crashAutoReport: boolean | null;
  setTheme: (theme: ThemePreference) => void;
  setLocale: (locale: LocalePreference) => void;
  setColorScheme: (scheme: ColorSchemePreference) => void;
  update: (
    patch: Partial<
      Omit<
        PreferencesState,
        "setTheme" | "setLocale" | "setColorScheme" | "update"
      >
    >,
  ) => void;
};

type PersistedV1 = { txConfirm?: boolean } & Record<string, unknown>;

/**
 * 持久化偏好的版本迁移。
 * - v2：布尔 `txConfirm` 升成三态——开（老默认值）= 智能，关 = 关闭；"每次双重验证"只由用户主动选。
 * - v3：语言默认值从"跟随系统"改为"默认语言"（租户在管理端设的回退语言）。以前存下的
 *   "system" 分不清是默认值还是用户主动选的，统一按默认值迁走。
 */
export function migratePreferences(
  persisted: unknown,
  version: number,
): Record<string, unknown> {
  let state = (persisted ?? {}) as PersistedV1;
  if (version < 2) {
    const { txConfirm, ...rest } = state;
    state = { ...rest, txVerification: txConfirm === false ? "off" : "smart" };
  }
  if (version < 3 && state.locale === "system")
    state = { ...state, locale: "default" };
  return state;
}

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: "system",
      locale: "default",
      colorScheme: "green-up",
      appLockEnabled: true,
      appLockMethod: "biometric",
      autoLockMinutes: 5,
      keyUnlockSeconds: 60,
      txVerification: "smart",
      largeAmountThresholdUsd: 1000,
      sendWhitelistOnly: false,
      crashAutoReport: null,
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      setColorScheme: (colorScheme) => set({ colorScheme }),
      update: (patch) => set(patch),
    }),
    {
      name: "foundation.preferences.v1",
      version: 3,
      storage: createJSONStorage(() => AsyncStorage),
      migrate: (persisted, version) =>
        migratePreferences(persisted, version) as unknown as PreferencesState,
      partialize: ({
        theme,
        locale,
        colorScheme,
        appLockEnabled,
        appLockMethod,
        autoLockMinutes,
        txVerification,
        largeAmountThresholdUsd,
        sendWhitelistOnly,
        crashAutoReport,
      }) => ({
        theme,
        locale,
        colorScheme,
        appLockEnabled,
        appLockMethod,
        autoLockMinutes,
        txVerification,
        largeAmountThresholdUsd,
        sendWhitelistOnly,
        crashAutoReport,
      }),
    },
  ),
);
