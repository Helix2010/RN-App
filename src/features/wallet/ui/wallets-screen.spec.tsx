import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import {
  createTestGateways,
  fakeNavigation,
  renderWithProviders,
} from "../../../test/harness";
import { ToastHost } from "../../../design-system";
import { WalletsScreen } from "./wallets-screen";
import type { Session } from "../../session/model/session";
import type { WalletAccount } from "../model/wallet";

const ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";

function account(): WalletAccount {
  return {
    address: ADDRESS,
    label: "主钱包",
    connector: "embedded",
    chains: ["bsc"],
    backedUp: true,
    current: true,
  };
}

function signedIn(): Session {
  return {
    address: ADDRESS,
    connector: "embedded",
    chains: ["bsc"],
    expiresAt: "2099-01-01T00:00:00.000Z",
    signedInAt: "2026-09-01T00:00:00.000Z",
  };
}

async function renderScreen(
  overrides: Parameters<typeof createTestGateways>[0] = {},
) {
  const gateways = createTestGateways(overrides);
  gateways.session.get = jest.fn(async () => signedIn());
  gateways.wallet.listAccounts = jest.fn(async () => [account()]);
  const navigation = fakeNavigation({ popToTop: jest.fn() });
  const rendered = await renderWithProviders(
    <>
      <WalletsScreen navigation={navigation} route={fakeNavigation()} />
      {/* 真实 App 里 ToastHost 挂在根组件；断言提示就得把它渲染出来 */}
      <ToastHost />
    </>,
    { gateways },
  );
  return { ...rendered, navigation };
}

describe("WalletsScreen", () => {
  it("says so when disconnecting fails", async () => {
    const { gateways, runtime } = await renderScreen();
    gateways.wallet.disconnect = jest.fn(async () => {
      throw new Error("network down");
    });

    void fireEvent.press(await screen.findByTestId("wallets-disconnect"));
    void fireEvent.press(
      await screen.findByTestId("wallets-disconnect-confirm"),
    );

    await waitFor(() =>
      expect(
        screen.getByText(runtime.t("wallets.disconnectFailed")),
      ).toBeTruthy(),
    );
  });

  it("keeps the wallet signed in when disconnect fails", async () => {
    const { gateways, navigation } = await renderScreen();
    gateways.wallet.disconnect = jest.fn(async () => {
      throw new Error("network down");
    });

    void fireEvent.press(await screen.findByTestId("wallets-disconnect"));
    void fireEvent.press(
      await screen.findByTestId("wallets-disconnect-confirm"),
    );

    await waitFor(() => expect(gateways.wallet.disconnect).toHaveBeenCalled());
    // 失败了就不能把用户踢出登录态
    expect(navigation.popToTop).not.toHaveBeenCalled();
  });

  // 放在最后：RNTL 14 + React 19 下用过 fireEvent.changeText 的测试会让**后续**
  // 测试渲染出空树，把它排到末尾比给每个测试加 workaround 干净
  it("says so when renaming fails instead of looking like nothing happened", async () => {
    // 回归：以前是 `void saveLabel()` 且没有 try/catch，失败时界面毫无变化
    const { gateways, runtime } = await renderScreen();
    gateways.wallet.rename = jest.fn(async () => {
      throw new Error("storage full");
    });

    void fireEvent.press(await screen.findByTestId("wallets-rename"));
    void fireEvent.changeText(
      await screen.findByTestId("wallets-rename-input"),
      "交易号",
    );
    void fireEvent.press(screen.getByTestId("wallets-rename-save"));

    await waitFor(() =>
      expect(screen.getByText(runtime.t("wallets.renameFailed"))).toBeTruthy(),
    );
  });
});
