import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type NotificationKey =
  | "orderFilled"
  | "orderCancelled"
  | "predictSettled"
  | "predictClaimable"
  | "predictDispute"
  | "predictClosingSoon"
  | "swapResult"
  | "priceAlert"
  | "promo"
  | "security";

export type AccountPreferences = {
  quoteCurrency: string;
  predict: {
    confirmBeforeOrder: boolean;
    defaultOrderType: "market" | "limit";
  };
  dex: { defaultSlippage: "auto" | number; riskWarning: boolean };
  notifications: Record<NotificationKey, boolean>;
  dnd: { enabled: boolean; start: string; end: string };
};

const DEFAULT_ACCOUNT_PREFERENCES: AccountPreferences = {
  quoteCurrency: "USDT",
  predict: { confirmBeforeOrder: true, defaultOrderType: "market" },
  dex: { defaultSlippage: "auto", riskWarning: true },
  notifications: {
    orderFilled: true,
    orderCancelled: true,
    predictSettled: true,
    predictClaimable: true,
    predictDispute: true,
    predictClosingSoon: false,
    swapResult: true,
    priceAlert: true,
    promo: false,
    security: true,
  },
  dnd: { enabled: true, start: "23:00", end: "08:00" },
};

/**
 * 账户级偏好：一期落本地并按钱包地址隔离（决策 D5），后续由 RN-Server `/v1/mobile/preferences` 同步。
 * 写入即时生效（乐观更新），接入服务端后失败回滚。
 */
type AccountPreferencesState = {
  byAddress: Record<string, AccountPreferences>;
  get: (address: string | undefined) => AccountPreferences;
  patch: (address: string, patch: Partial<AccountPreferences>) => void;
  setNotification: (
    address: string,
    key: NotificationKey,
    value: boolean,
  ) => void;
  clear: (address: string) => void;
};

export const useAccountPreferences = create<AccountPreferencesState>()(
  persist(
    (set, get) => ({
      byAddress: {},
      get: (address) =>
        address
          ? {
              ...DEFAULT_ACCOUNT_PREFERENCES,
              ...get().byAddress[address.toLowerCase()],
            }
          : DEFAULT_ACCOUNT_PREFERENCES,
      patch: (address, patch) =>
        set((state) => {
          const key = address.toLowerCase();
          const current = {
            ...DEFAULT_ACCOUNT_PREFERENCES,
            ...state.byAddress[key],
          };
          return {
            byAddress: {
              ...state.byAddress,
              [key]: {
                ...current,
                ...patch,
                predict: { ...current.predict, ...patch.predict },
                dex: { ...current.dex, ...patch.dex },
                notifications: {
                  ...current.notifications,
                  ...patch.notifications,
                },
                dnd: { ...current.dnd, ...patch.dnd },
              },
            },
          };
        }),
      setNotification: (address, key, value) => {
        if (key === "security") return;
        get().patch(address, {
          notifications: { ...get().get(address).notifications, [key]: value },
        });
      },
      clear: (address) =>
        set((state) => {
          const next = { ...state.byAddress };
          delete next[address.toLowerCase()];
          return { byAddress: next };
        }),
    }),
    {
      name: "foundation.account-preferences.v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ byAddress }) => ({ byAddress }),
    },
  ),
);

/** 便捷 hook：当前地址的账户级偏好（订阅变化）。 */
export function useAccountPrefs(
  address: string | undefined,
): AccountPreferences {
  const entry = useAccountPreferences((state) =>
    address ? state.byAddress[address.toLowerCase()] : undefined,
  );
  return { ...DEFAULT_ACCOUNT_PREFERENCES, ...entry };
}
