import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { SupportedLocale } from "../config/bootstrap.schema";

export type ThemePreference = "system" | "light" | "dark";
export type LocalePreference = "system" | SupportedLocale;
/** 涨跌颜色：绿涨红跌（默认）/ 红涨绿跌。只交换 pricePositive / priceNegative，Yes/No 语义色不跟随。 */
export type ColorSchemePreference = "green-up" | "red-up";
export type AppLockMethod = "biometric" | "pin";

/**
 * 设备级偏好（不随账户同步）：语言 / 主题 / 涨跌色 / 应用锁 / 交易前验证 / 大额阈值 / 地址簿白名单。
 * 存储键沿用 foundation.preferences.v1，新增字段有默认值，老数据可直接升级。
 */
type PreferencesState = {
  theme: ThemePreference;
  locale: LocalePreference;
  colorScheme: ColorSchemePreference;
  appLockEnabled: boolean;
  appLockMethod: AppLockMethod;
  autoLockMinutes: 0 | 1 | 5 | 15;
  txConfirm: boolean;
  largeAmountThresholdUsd: number;
  sendWhitelistOnly: boolean;
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

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: "system",
      locale: "system",
      colorScheme: "green-up",
      appLockEnabled: true,
      appLockMethod: "biometric",
      autoLockMinutes: 5,
      txConfirm: true,
      largeAmountThresholdUsd: 1000,
      sendWhitelistOnly: false,
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      setColorScheme: (colorScheme) => set({ colorScheme }),
      update: (patch) => set(patch),
    }),
    {
      name: "foundation.preferences.v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({
        theme,
        locale,
        colorScheme,
        appLockEnabled,
        appLockMethod,
        autoLockMinutes,
        txConfirm,
        largeAmountThresholdUsd,
        sendWhitelistOnly,
      }) => ({
        theme,
        locale,
        colorScheme,
        appLockEnabled,
        appLockMethod,
        autoLockMinutes,
        txConfirm,
        largeAmountThresholdUsd,
        sendWhitelistOnly,
      }),
    },
  ),
);
