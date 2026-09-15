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

export type PendingInvite = {
  /** 用户点进来的邀请码原文 */
  code: string;
  /** 写入时刻（毫秒）。过期判定用它，不用服务端时间 */
  savedAt: number;
};

type PendingInviteState = {
  pending: PendingInvite | null;
  /**
   * 本次进程写过这个 store 没有。0 = 没写过。
   *
   * 它只为一件事存在：zustand persist 的 rehydrate 是异步的，而
   * `Linking.getInitialURL()` 也是异步的，两者谁先返回是真竞态。默认的
   * `merge` 是 `{...currentState, ...persistedState}`——**磁盘上的值覆盖内存里的**，
   * 方向正好相反。冷启动时如果 `remember()` 先跑完、rehydrate 后落地，
   * 刚存进去的邀请码就被磁盘上的旧值（哪怕是 `null`）盖掉，整条深链路径静默失败。
   * 见下面的 merge。
   */
  writtenAt: number;
  /** 后到覆盖先到：最后点的那个链接代表用户当下的意图 */
  remember: (code: string, now?: number) => void;
  forget: () => void;
};

export const usePendingInviteStore = create<PendingInviteState>()(
  persist(
    (set) => ({
      pending: null,
      writtenAt: 0,
      remember: (code, now = Date.now()) =>
        set({ pending: { code, savedAt: now }, writtenAt: now }),
      forget: () => set({ pending: null, writtenAt: Date.now() }),
    }),
    {
      name: "foundation.referral.v1",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      /**
       * 本次进程已经写过就以内存为准，磁盘上的一律是旧的。
       *
       * 不按 `savedAt` 比新旧：`forget()` 之后内存里是 `null`，没有时间戳可比，
       * 而那正是"用户刚拒绝了这个邀请"的状态，绝不能被磁盘上的旧码复活。
       * "本次进程写过没有"才是这里真正要问的问题。
       */
      merge: (persisted, current) =>
        current.writtenAt > 0
          ? current
          : { ...current, ...(persisted as Partial<PendingInviteState>) },
    },
  ),
);

/**
 * 暂存还新鲜吗。
 *
 * 判定只有这一处实现：渲染时用 `useNow()`（挂载时刻）判该不该弹确认，
 * **提交时必须用 `Date.now()` 再判一次**。`useNow()` 不带 ticking 时取的是
 * 挂载时刻且此后不变，而 stack 页在后台会一直挂着——确认层敞开过夜，
 * 第二天点一下照样能绑，而绑定永久不可解除。30 分钟这道闸是设计 §5.3
 * 专门设的，不能只在渲染期成立。
 */
export function isPendingInviteFresh(
  pending: PendingInvite | null,
  now: number,
): boolean {
  return pending !== null && now - pending.savedAt <= PENDING_INVITE_TTL_MS;
}
