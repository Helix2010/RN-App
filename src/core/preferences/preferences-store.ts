import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { SupportedLocale } from "../config/bootstrap.schema";

export type ThemePreference = "system" | "light" | "dark";
export type LocalePreference = "system" | SupportedLocale;

type PreferencesState = {
  theme: ThemePreference;
  locale: LocalePreference;
  setTheme: (theme: ThemePreference) => void;
  setLocale: (locale: LocalePreference) => void;
};

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      theme: "system",
      locale: "system",
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: "foundation.preferences.v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ theme, locale }) => ({ theme, locale }),
    },
  ),
);
