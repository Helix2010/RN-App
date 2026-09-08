import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * 收藏的事件 id，本机持久化（与网页版一样是本地星标，平台没有收藏接口）。
 * 上限 50 条：超出时丢最早收藏的。收藏页是逐个 `GET /events/{id}`，平台按 IP 限流，不能放开。
 */
const LIMIT = 50;

type FavoritesState = {
  ids: string[];
  toggle: (eventId: string) => void;
  has: (eventId: string) => boolean;
};

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set, get) => ({
      ids: [],
      toggle: (eventId) =>
        set((state) => {
          if (state.ids.includes(eventId))
            return { ids: state.ids.filter((id) => id !== eventId) };
          return { ids: [...state.ids, eventId].slice(-LIMIT) };
        }),
      has: (eventId) => get().ids.includes(eventId),
    }),
    {
      name: "predict.favorites.v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({ ids: state.ids }),
    },
  ),
);

export function useIsFavorite(eventId: string): boolean {
  return useFavoritesStore((state) => state.ids.includes(eventId));
}
