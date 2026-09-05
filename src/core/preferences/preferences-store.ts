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
  txVerification: TxVerificationPolicy;
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

type PersistedV1 = { txConfirm?: boolean } & Record<string, unknown>;

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: "system",
      locale: "system",
      colorScheme: "green-up",
      appLockEnabled: true,
      appLockMethod: "biometric",
      autoLockMinutes: 5,
      txVerification: "smart",
      largeAmountThresholdUsd: 1000,
      sendWhitelistOnly: false,
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      setColorScheme: (colorScheme) => set({ colorScheme }),
      update: (patch) => set(patch),
    }),
    {
      name: "foundation.preferences.v1",
      version: 2,
      storage: createJSONStorage(() => AsyncStorage),
      // v1 的布尔开关：开（老默认值）= 智能，关 = 关闭；"每次双重验证"只由用户主动选
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as PersistedV1;
        if (version >= 2) return state as unknown as PreferencesState;
        const { txConfirm, ...rest } = state;
        return {
          ...rest,
          txVerification: txConfirm === false ? "off" : "smart",
        } as unknown as PreferencesState;
      },
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
      }),
    },
  ),
);
