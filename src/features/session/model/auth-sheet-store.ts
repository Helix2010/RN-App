import { create } from "zustand";
import type { AuthIntent } from "./session";

/**
 * 登录 sheet 的全局状态：任何页面的写操作调用 `requestAuth(intent)`，
 * 登录成功后 `consumeIntent()` 交回意图由原页面继续。
 */
type AuthSheetState = {
  open: boolean;
  intent: AuthIntent;
  /** 登录成功但尚未被页面消费的意图 */
  fulfilled: AuthIntent | null;
  requestAuth: (intent?: AuthIntent) => void;
  close: () => void;
  fulfill: () => void;
  consumeIntent: () => AuthIntent | null;
};

export const useAuthSheet = create<AuthSheetState>((set, get) => ({
  open: false,
  intent: { type: "none" },
  fulfilled: null,
  requestAuth: (intent = { type: "none" }) => set({ open: true, intent }),
  close: () => set({ open: false }),
  fulfill: () =>
    set((state) => ({
      open: false,
      fulfilled: state.intent.type === "none" ? null : state.intent,
    })),
  consumeIntent: () => {
    const { fulfilled } = get();
    if (fulfilled) set({ fulfilled: null });
    return fulfilled;
  },
}));

export function requestAuth(intent?: AuthIntent): void {
  useAuthSheet.getState().requestAuth(intent);
}
