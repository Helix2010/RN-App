import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { MockReferralGateway } from "../api/mock-referral-gateway";
import { usePendingInviteStore } from "../../../core/deep-link/pending-invite-store";
import { fakeNavigation, renderWithProviders } from "../../../test/harness";
import { ReferralScreen } from "./referral-screen";

async function renderScreen(
  options: { gateway?: MockReferralGateway; enabled?: boolean } = {},
) {
  const referral = options.gateway ?? new MockReferralGateway();
  const navigation = fakeNavigation();
  const view = await renderWithProviders(
    <ReferralScreen
      navigation={navigation}
      route={{ key: "Referral", name: "Referral", params: undefined } as never}
    />,
    {
      gateways: { referral },
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
  usePendingInviteStore.setState({ pending: null });
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
