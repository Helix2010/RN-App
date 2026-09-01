import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { fakeNavigation, renderWithProviders } from "../../../test/harness";
import { WalletSetupScreen } from "./wallet-setup-screen";

function renderSetup(navigation = fakeNavigation({ replace: jest.fn() })) {
  return renderWithProviders(
    <WalletSetupScreen navigation={navigation} route={fakeNavigation()} />,
  );
}

describe("WalletSetupScreen", () => {
  it("creates a wallet and goes straight to the backup flow with the phrase", async () => {
    const navigation = fakeNavigation({ replace: jest.fn() });
    await renderSetup(navigation);
    void fireEvent.press(await screen.findByTestId("wallet-setup-create"));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    const [routeName, params] = navigation.replace.mock.calls[0] as [
      string,
      { phrase: string },
    ];
    expect(routeName).toBe("WalletBackup");
    expect(params.phrase.split(" ")).toHaveLength(12);
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
