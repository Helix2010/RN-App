import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import {
  createTestGateways,
  fakeNavigation,
  renderWithProviders,
} from "../../../test/harness";
import { WalletPassphraseScreen } from "./wallet-passphrase-screen";

async function renderScreen(enablePassphrase = jest.fn(async () => undefined)) {
  const navigation = fakeNavigation({
    goBack: jest.fn(),
    popToTop: jest.fn(),
  });
  const wallet = createTestGateways().wallet;
  wallet.enablePassphrase = enablePassphrase;
  return {
    navigation,
    enablePassphrase,
    ...(await renderWithProviders(
      <WalletPassphraseScreen
        navigation={navigation}
        route={fakeNavigation()}
      />,
      { gateways: { wallet } },
    )),
  };
}

/**
 * 这个 harness 里 `fireEvent.changeText` 不会同步刷新 React 状态，所以每一处
 * 断言都要等（`findBy*` / `waitFor`）。同步读 props 会读到改之前的那一帧。
 */
async function type(testID: string, value: string) {
  void fireEvent.changeText(await screen.findByTestId(testID), value);
}

describe("WalletPassphraseScreen", () => {
  it("两次输入一致且够长才真的启用", async () => {
    const { enablePassphrase } = await renderScreen();

    // 什么都没输就按：不应该发生任何事
    void fireEvent.press(await screen.findByTestId("wallet-passphrase-submit"));
    expect(enablePassphrase).not.toHaveBeenCalled();

    // 两次不一致：也不应该发生任何事，而且要说出来
    await type("wallet-passphrase-input", "correct horse");
    await type("wallet-passphrase-confirm", "correct hors");
    expect(await screen.findByText("两次输入不一致")).toBeTruthy();
    void fireEvent.press(screen.getByTestId("wallet-passphrase-submit"));
    expect(enablePassphrase).not.toHaveBeenCalled();

    await type("wallet-passphrase-confirm", "correct horse");
    await waitFor(() =>
      expect(
        screen.getByTestId("wallet-passphrase-submit").props["aria-disabled"],
      ).toBeFalsy(),
    );
    void fireEvent.press(screen.getByTestId("wallet-passphrase-submit"));

    await waitFor(() =>
      expect(enablePassphrase).toHaveBeenCalledWith(
        "correct horse",
        "wallet.passphrase.authReason",
      ),
    );
  });

  it("太短的口令启用不了，而且当场说出来", async () => {
    const { enablePassphrase } = await renderScreen();

    await type("wallet-passphrase-input", "short");
    await type("wallet-passphrase-confirm", "short");

    expect(await screen.findByText("口令至少 8 位")).toBeTruthy();
    void fireEvent.press(screen.getByTestId("wallet-passphrase-submit"));
    expect(enablePassphrase).not.toHaveBeenCalled();
  });

  // 这是加固引导，不是门禁。做成必填只会让一部分用户随手输一串记不住的东西
  it("可以跳过，而且回到进来的那个地方", async () => {
    const { navigation } = await renderScreen();

    void fireEvent.press(await screen.findByTestId("wallet-passphrase-skip"));

    // 从安全中心进来要回安全中心；写死 popToTop 会把人甩回首页
    expect(navigation.goBack).toHaveBeenCalled();
    expect(navigation.popToTop).not.toHaveBeenCalled();
  });

  it("退不回去时才 popToTop", async () => {
    const navigation = fakeNavigation({
      goBack: jest.fn(),
      popToTop: jest.fn(),
      canGoBack: jest.fn(() => false),
    });
    const wallet = createTestGateways().wallet;
    await renderWithProviders(
      <WalletPassphraseScreen
        navigation={navigation}
        route={fakeNavigation()}
      />,
      { gateways: { wallet } },
    );

    void fireEvent.press(await screen.findByTestId("wallet-passphrase-skip"));

    expect(navigation.popToTop).toHaveBeenCalled();
  });

  // 忘记口令无法找回，这句话必须在用户按下按钮之前就看得见
  it("把忘了找不回来这句话说在前面", async () => {
    await renderScreen();

    expect(await screen.findByText(/忘记口令无法找回/)).toBeTruthy();
  });
});
