import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { fakeNavigation, renderWithProviders } from "../../../test/harness";
import { clearPendingPhrase, takePendingPhrase } from "../model/pending-reveal";
import { WalletSetupScreen } from "./wallet-setup-screen";

function renderSetup(navigation = fakeNavigation({ replace: jest.fn() })) {
  return renderWithProviders(
    <WalletSetupScreen navigation={navigation} route={fakeNavigation()} />,
  );
}

describe("WalletSetupScreen", () => {
  it("creates a wallet and hands the phrase over without putting it in the route", async () => {
    const navigation = fakeNavigation({ replace: jest.fn() });
    await renderSetup(navigation);
    void fireEvent.press(await screen.findByTestId("wallet-setup-create"));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    const [routeName, params] = navigation.replace.mock.calls[0] as [
      string,
      unknown,
    ];
    expect(routeName).toBe("WalletBackup");
    // 助记词不进导航参数：导航状态会被持久化和上报读到（安全评审 N36）
    expect(params).toBeUndefined();
    const handed = takePendingPhrase();
    expect(handed?.split(" ")).toHaveLength(12);
    // 一次性：备份页取走后再没有第二份
    expect(takePendingPhrase()).toBeNull();
    clearPendingPhrase();
  });

  it("routes to the import screen", async () => {
    const navigation = fakeNavigation({ replace: jest.fn() });
    await renderSetup(navigation);
    void fireEvent.press(await screen.findByTestId("wallet-setup-import"));
    expect(navigation.navigate).toHaveBeenCalledWith("WalletImport");
  });

  it("spells out that recovery is the user's own responsibility", async () => {
    const { runtime } = await renderSetup();
    expect(
      screen.getByText(runtime.t("wallet.setup.custodyNotice")),
    ).toBeTruthy();
  });
});
