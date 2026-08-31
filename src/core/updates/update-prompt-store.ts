import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

const DAY_MS = 24 * 60 * 60 * 1_000;

export type UpdatePromptInput = {
  decision: "none" | "optional" | "recommended" | "required";
  latestVersion: string;
  lastPromptedVersion: string | null;
  lastPromptedAt: string | null;
  nowMs: number;
};

/**
 * S-07 软更新节流：同一版本每天最多提醒一次；强制更新不受节流约束（不可关闭）。
 * 纯函数，便于单测；持久化状态见 `useUpdatePromptStore`。
 */
export function shouldPromptUpdate(input: UpdatePromptInput): boolean {
  if (input.decision === "none") return false;
  if (input.decision === "required") return true;
  if (input.lastPromptedVersion !== input.latestVersion) return true;
  if (!input.lastPromptedAt) return true;
  const last = new Date(input.lastPromptedAt).getTime();
  if (!Number.isFinite(last)) return true;
  return input.nowMs - last >= DAY_MS;
}

type UpdatePromptState = {
  lastPromptedVersion: string | null;
  lastPromptedAt: string | null;
  markPrompted: (version: string, nowMs?: number) => void;
};

/** 设备级：软更新提醒的节流记录（`foundation.update-prompt.v1`）。 */
export const useUpdatePromptStore = create<UpdatePromptState>()(
  persist(
    (set) => ({
      lastPromptedVersion: null,
      lastPromptedAt: null,
      markPrompted: (version, nowMs = Date.now()) =>
        set({
          lastPromptedVersion: version,
          lastPromptedAt: new Date(nowMs).toISOString(),
        }),
    }),
    {
      name: "foundation.update-prompt.v1",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ lastPromptedVersion, lastPromptedAt }) => ({
        lastPromptedVersion,
        lastPromptedAt,
      }),
    },
  ),
);
