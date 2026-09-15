import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * 深链带来的邀请码的本机暂存（设计 referral-graph-2026-09-15 §5.3）。
 *
 * 有效期 **30 分钟**，不是绑定窗口的 7 天：深链的正常路径是"点了就登录"。
 * 存 7 天等于在本机留一个攻击者可控的输入，在用户早已忘记的某次登录上生效——
 * 而绑定是永久不可解除的。
 *
 * 存的是**原文**，不做任何归一化：归一化只在服务端一处做。
 */
export const PENDING_INVITE_TTL_MS = 30 * 60 * 1000;

type PendingInvite = {
  /** 用户点进来的邀请码原文 */
  code: string;
  /** 写入时刻（毫秒）。过期判定用它，不用服务端时间 */
  savedAt: number;
};

type PendingInviteState = {
  pending: PendingInvite | null;
  /** 后到覆盖先到：最后点的那个链接代表用户当下的意图 */
  remember: (code: string, now?: number) => void;
  forget: () => void;
};

export const usePendingInviteStore = create<PendingInviteState>()(
  persist(
    (set) => ({
      pending: null,
      remember: (code, now = Date.now()) =>
        set({ pending: { code, savedAt: now } }),
      forget: () => set({ pending: null }),
    }),
    {
      name: "foundation.referral.v1",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
