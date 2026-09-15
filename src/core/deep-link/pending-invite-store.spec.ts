import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  PENDING_INVITE_TTL_MS,
  isPendingInviteFresh,
  usePendingInviteStore,
} from "./pending-invite-store";

beforeEach(async () => {
  await AsyncStorage.clear();
  usePendingInviteStore.setState({ pending: null, writtenAt: 0 });
});

/**
 * 冷启动竞态：`Linking.getInitialURL()` 与 zustand persist 的 rehydrate 都是异步的，
 * 谁先返回不确定。zustand 默认的 merge 是 `{...current, ...persisted}`——
 * **磁盘覆盖内存**，方向正好相反。`remember()` 先跑完、rehydrate 后落地的话，
 * 刚存进去的邀请码会被磁盘上的旧值（哪怕是 null）盖掉，整条深链路径静默失败。
 *
 * 用过一次之后才会出问题：存储为空时 merge 是恒等，第一次装机看不出来。
 */
describe("rehydrate 与深链写入的竞态", () => {
  /**
   * 让 `getItem` 慢一拍，复刻真实时序：读已经发出并抓到了旧内容，此时深链到达
   * 写了新值，读才落地。直接 `setItem` 再 `rehydrate()` 是复刻不出来的——
   * `remember()` 自己会写一次盘，把刚种下的旧值冲掉。
   */
  function seedAndStall(stored: unknown): void {
    const payload = JSON.stringify(stored);
    jest
      .spyOn(AsyncStorage, "getItem")
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(payload), 20)),
      );
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("读在飞行中时到达的深链，不能被落地的旧值盖掉", async () => {
    // 磁盘上是上一次 forget() 留下的空值
    seedAndStall({ state: { pending: null, writtenAt: 1 }, version: 1 });
    const hydrating = usePendingInviteStore.persist.rehydrate();
    // 深链在读落地之前到达
    usePendingInviteStore.getState().remember("ABCD1234");
    expect(usePendingInviteStore.getState().pending?.code).toBe("ABCD1234");
    await hydrating;
    expect(usePendingInviteStore.getState().pending?.code).toBe("ABCD1234");
  });

  it("用户刚拒绝过，落地的旧码不能被复活", async () => {
    seedAndStall({
      state: {
        pending: { code: "OLDCODE1", savedAt: Date.now() },
        writtenAt: 1,
      },
      version: 1,
    });
    const hydrating = usePendingInviteStore.persist.rehydrate();
    usePendingInviteStore.getState().forget();
    await hydrating;
    expect(usePendingInviteStore.getState().pending).toBeNull();
  });

  it("本次进程还没动过时，磁盘上的值照常恢复", async () => {
    const savedAt = Date.now();
    seedAndStall({
      state: { pending: { code: "ZZZZ9999", savedAt }, writtenAt: 0 },
      version: 1,
    });
    await usePendingInviteStore.persist.rehydrate();
    expect(usePendingInviteStore.getState().pending?.code).toBe("ZZZZ9999");
  });
});

// 30 分钟这道闸是设计 §5.3 的安全闸：存 7 天等于留一个攻击者可控的输入，
// 在用户早已忘记的某次登录上生效，而绑定永久不可解除。
describe("暂存的新鲜度", () => {
  it("刚写入的是新鲜的，超过 TTL 的不是", () => {
    const now = 1_000_000_000_000;
    expect(isPendingInviteFresh({ code: "A", savedAt: now }, now)).toBe(true);
    expect(
      isPendingInviteFresh(
        { code: "A", savedAt: now - PENDING_INVITE_TTL_MS },
        now,
      ),
    ).toBe(true);
    expect(
      isPendingInviteFresh(
        { code: "A", savedAt: now - PENDING_INVITE_TTL_MS - 1 },
        now,
      ),
    ).toBe(false);
    expect(isPendingInviteFresh(null, now)).toBe(false);
  });
});
