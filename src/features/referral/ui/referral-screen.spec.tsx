import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { MockReferralGateway } from "../api/mock-referral-gateway";
import {
  PENDING_INVITE_TTL_MS,
  usePendingInviteStore,
} from "../../../core/deep-link/pending-invite-store";
import {
  createTestGateways,
  fakeNavigation,
  renderWithProviders,
  signIn,
} from "../../../test/harness";
import { travelTestClock } from "../../../test/clock";
import { ReferralScreen } from "./referral-screen";

// 概览是会话级的（queryKey 带地址，和个人中心共用一份缓存），
// 所以每个用例都要先登录，否则页面走的是游客分支
async function renderScreen(
  options: { gateway?: MockReferralGateway; enabled?: boolean } = {},
) {
  const referral = options.gateway ?? new MockReferralGateway();
  const gateways = createTestGateways({ referral });
  await signIn(gateways);
  const navigation = fakeNavigation();
  const view = await renderWithProviders(
    <ReferralScreen
      navigation={navigation}
      route={{ key: "Referral", name: "Referral", params: undefined } as never}
    />,
    {
      gateways,
      config: (config) => ({
        ...config,
        referral: {
          ...config.referral,
          enabled: options.enabled ?? true,
          inviteLinkBase: "https://api.example.com/app/invite/",
        },
      }),
    },
  );
  return { ...view, referral, navigation };
}

beforeEach(() => {
  usePendingInviteStore.setState({ pending: null, writtenAt: 0 });
});

// toast 与 mutation 都活在全局层，不清的话上一个用例的提示和在飞的请求会漏进
// 下一个用例。用例一多就会出现"单跑全过、一起跑就挂"的不稳定
afterEach(() => {
  jest.restoreAllMocks();
});

describe("邀请好友", () => {
  it("展示我的邀请码，分段显示但不改变原值", async () => {
    await renderScreen({
      gateway: new MockReferralGateway({ inviteCode: "ABCD1234" }),
    });
    // 分段只是展示；可访问名保留原值，读屏与复制拿到的都是它
    expect(await screen.findByText("ABCD-1234")).toBeTruthy();
    expect(screen.getByLabelText("ABCD1234")).toBeTruthy();
  });

  it("租户没开启邀请时只显示说明，不请求也不给入口", async () => {
    const referral = new MockReferralGateway();
    const spy = jest.spyOn(referral, "overview");
    await renderScreen({ gateway: referral, enabled: false });
    expect(await screen.findByText("邀请功能暂未开放")).toBeTruthy();
    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("referral-code-input")).toBeNull();
  });

  // 绑定永久不可解除，Toast 承担不了这种承诺
  it("手输邀请码要先过确认层才真的绑定", async () => {
    const referral = new MockReferralGateway({ validCodes: ["ZZZZ9999"] });
    const bind = jest.spyOn(referral, "bind");
    await renderScreen({ gateway: referral });

    void fireEvent.changeText(
      await screen.findByTestId("referral-code-input"),
      "ZZZZ9999",
    );
    void fireEvent.press(await screen.findByTestId("referral-bind"));

    // 点了绑定还没真绑，先出现确认层
    expect(await screen.findByTestId("referral-confirm-body")).toBeTruthy();
    expect(bind).not.toHaveBeenCalled();

    void fireEvent.press(await screen.findByTestId("referral-confirm"));
    await waitFor(() => expect(bind).toHaveBeenCalledWith("ZZZZ9999", "code"));
  });

  it("确认层里取消就不绑，并清掉深链暂存", async () => {
    const referral = new MockReferralGateway({ validCodes: ["ZZZZ9999"] });
    const bind = jest.spyOn(referral, "bind");
    usePendingInviteStore.setState({
      pending: { code: "ZZZZ9999", savedAt: Date.now() },
    });
    await renderScreen({ gateway: referral });

    void fireEvent.press(await screen.findByTestId("referral-confirm-cancel"));
    await waitFor(() =>
      expect(usePendingInviteStore.getState().pending).toBeNull(),
    );
    expect(bind).not.toHaveBeenCalled();
  });

  // 用户在深链里同意的是"打开应用"，不是"永久挂在一个陌生人名下"
  it("深链带来的邀请码不自动提交，先弹确认", async () => {
    const referral = new MockReferralGateway({ validCodes: ["ZZZZ9999"] });
    const bind = jest.spyOn(referral, "bind");
    usePendingInviteStore.setState({
      pending: { code: "ZZZZ9999", savedAt: Date.now() },
    });
    await renderScreen({ gateway: referral });

    expect(await screen.findByTestId("referral-confirm-body")).toBeTruthy();
    expect(bind).not.toHaveBeenCalled();

    void fireEvent.press(await screen.findByTestId("referral-confirm"));
    await waitFor(() => expect(bind).toHaveBeenCalledWith("ZZZZ9999", "link"));
  });

  // 暂存有效期 30 分钟：存 7 天等于留一个攻击者可控的输入，
  // 在用户早已忘记的某次登录上生效
  it("暂存超过 30 分钟就不再弹确认", async () => {
    const referral = new MockReferralGateway({ validCodes: ["ZZZZ9999"] });
    usePendingInviteStore.setState({
      pending: { code: "ZZZZ9999", savedAt: Date.now() - 31 * 60 * 1000 },
    });
    await renderScreen({ gateway: referral });

    await screen.findByTestId("referral-code-card");
    expect(screen.queryByTestId("referral-confirm-body")).toBeNull();
  });

  it("已经有邀请人时不再弹确认，也不显示输入框", async () => {
    const referral = new MockReferralGateway({ validCodes: ["ZZZZ9999"] });
    await referral.bind("ZZZZ9999", "code");
    usePendingInviteStore.setState({
      pending: { code: "ZZZZ9999", savedAt: Date.now() },
    });
    await renderScreen({ gateway: referral });

    expect(await screen.findByTestId("referral-inviter")).toBeTruthy();
    expect(screen.queryByTestId("referral-code-input")).toBeNull();
    expect(screen.queryByTestId("referral-confirm-body")).toBeNull();
  });

  it("绑定窗口已关时说明原因，不给输入框", async () => {
    await renderScreen({
      gateway: new MockReferralGateway({ windowOpen: false }),
    });
    expect(await screen.findByTestId("referral-window-closed")).toBeTruthy();
    expect(screen.queryByTestId("referral-code-input")).toBeNull();
  });

  it("还没有下级时是空态，不是 0 也不是演示数据", async () => {
    await renderScreen();
    expect(await screen.findByTestId("referral-invitees-empty")).toBeTruthy();
  });

  // 回归：曾经把「加载更多」写成 refetch()，那只会重拉第一页，
  // 网关的 cursor 参数永远用不上，第二页的人永远看不到
  it("加载更多真的翻到下一页，而不是重拉第一页", async () => {
    const referral = new MockReferralGateway({ pageSize: 2 });
    referral.seedInvitees([
      { alias: "aaa111", joinedAt: "2026-09-14T08:00:00.000Z" },
      { alias: "bbb222", joinedAt: "2026-09-13T08:00:00.000Z" },
      { alias: "ccc333", joinedAt: "2026-09-12T08:00:00.000Z" },
    ]);
    await renderScreen({ gateway: referral });

    expect(await screen.findByText("aaa111")).toBeTruthy();
    expect(screen.queryByText("ccc333")).toBeNull();

    void fireEvent.press(await screen.findByTestId("referral-load-more"));

    // 第三条出现，且前两条还在（跨页拼接，不是替换）
    expect(await screen.findByText("ccc333")).toBeTruthy();
    expect(screen.getByText("aaa111")).toBeTruthy();
    expect(screen.queryByTestId("referral-load-more")).toBeNull();
  });

  // 回归：失败原因可能正是"你在别的设备上已经绑过了"，那时服务端状态比本地新。
  // 不刷新的话页面会继续显示输入框，和真实状态对不上
  it("绑定失败后刷新，不把过期的输入框留在页面上", async () => {
    const referral = new MockReferralGateway({ validCodes: ["ZZZZ9999"] });
    const bind = jest
      .spyOn(referral, "bind")
      .mockRejectedValueOnce(new Error("REFERRAL_ALREADY_BOUND"));
    const overview = jest.spyOn(referral, "overview");
    await renderScreen({ gateway: referral });

    void fireEvent.changeText(
      await screen.findByTestId("referral-code-input"),
      "ZZZZ9999",
    );
    void fireEvent.press(await screen.findByTestId("referral-bind"));
    void fireEvent.press(await screen.findByTestId("referral-confirm"));

    await waitFor(() => expect(bind).toHaveBeenCalled());
    // 失败后重新拉过概览：首次渲染 1 次 + 失败后刷新 1 次
    await waitFor(() => expect(overview.mock.calls.length).toBeGreaterThan(1));
  });

  it("下级只显示别名与加入时间，不出现地址", async () => {
    const referral = new MockReferralGateway();
    referral.seedInvitees([
      { alias: "a1b2c3", joinedAt: "2026-09-14T08:00:00.000Z" },
    ]);
    await renderScreen({ gateway: referral });
    expect(await screen.findByText("a1b2c3")).toBeTruthy();
    expect(screen.queryByText(/^0x/)).toBeNull();
  });
});

/**
 * 确认层的状态机。绑定永久不可解除，所以"用户刚确认了什么"必须在整个提交
 * 过程里保持不变——否则他确认的是 A，绑上去的可能是 B。
 */
describe("确认层不会把用户没确认的码顶上来", () => {
  it("手输的码提交后，深链暂存的那个不能立刻再弹一次确认", async () => {
    const referral = new MockReferralGateway({
      validCodes: ["ZZZZ9999", "YYYY8888"],
    });
    // 让绑定在飞一会儿：缺陷就发生在提交之后、mutation 落地之前的那几帧
    const bind = jest.spyOn(referral, "bind").mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                inviteCode: "ZZZZ9999",
                boundAt: "2026-09-15T02:00:00.000Z",
              }),
            80,
          ),
        ),
    );
    // 深链带来一个码，用户不理它，自己输了另一个
    usePendingInviteStore.setState({
      pending: { code: "YYYY8888", savedAt: Date.now() },
      writtenAt: Date.now(),
    });
    await renderScreen({ gateway: referral });

    void fireEvent.changeText(
      await screen.findByTestId("referral-code-input"),
      "ZZZZ9999",
    );
    void fireEvent.press(await screen.findByTestId("referral-bind"));
    void fireEvent.press(await screen.findByTestId("referral-confirm"));

    await waitFor(() => expect(bind).toHaveBeenCalledWith("ZZZZ9999", "code"));

    // **缺陷窗口就在这里**：mutation 还在飞，onSuccess 的 forgetPending 还没跑。
    // 这一刻确认层不能换成深链那个码——用户刚确认完一次永久不可解除的绑定，
    // 紧接着被问"要不要绑另一个"，再点一下就是第二次提交。
    // 否定断言不能塞进 waitFor：第一次检查就成立，它立刻返回，什么都没等到
    expect(screen.queryByText(/YYYY-8888/)).toBeNull();

    // findAllByText：toast 是全局层，上一个用例留下的同名提示可能还挂着
    expect((await screen.findAllByText("已绑定邀请人")).length).toBeGreaterThan(
      0,
    );
    expect(bind).toHaveBeenCalledTimes(1);
    expect(bind).not.toHaveBeenCalledWith("YYYY8888", "link");
  });

  it("下级列表请求失败显示错误与重试，不画成空态", async () => {
    const referral = new MockReferralGateway();
    jest
      .spyOn(referral, "invitees")
      .mockRejectedValue(new Error("network is down"));
    await renderScreen({ gateway: referral });

    expect(await screen.findByTestId("referral-invitees-error")).toBeTruthy();
    expect(screen.getByTestId("referral-invitees-retry")).toBeTruthy();
    // "还没有人加入"是空态，不能拿来表示查询失败
    expect(screen.queryByTestId("referral-invitees-empty")).toBeNull();
  });

  // useNow() 取的是挂载时刻且此后不变，而 stack 页在后台会一直挂着
  it("确认层敞着放到过期，再点确认也不提交", async () => {
    const referral = new MockReferralGateway({ validCodes: ["ZZZZ9999"] });
    const bind = jest.spyOn(referral, "bind");
    usePendingInviteStore.setState({
      pending: { code: "ZZZZ9999", savedAt: Date.now() },
      writtenAt: Date.now(),
    });
    await renderScreen({ gateway: referral });
    expect(await screen.findByTestId("referral-confirm-body")).toBeTruthy();

    // 页面挂着不动，时间走过 TTL。渲染期用的是挂载时刻，所以确认层还开着——
    // 拦截必须发生在提交那一刻
    travelTestClock(PENDING_INVITE_TTL_MS + 1000);
    try {
      void fireEvent.press(await screen.findByTestId("referral-confirm"));
      await waitFor(() =>
        expect(usePendingInviteStore.getState().pending).toBeNull(),
      );
      expect(bind).not.toHaveBeenCalled();
    } finally {
      travelTestClock(-(PENDING_INVITE_TTL_MS + 1000));
    }
  });
});
