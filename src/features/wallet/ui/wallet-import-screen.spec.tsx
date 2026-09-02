import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { shortenAddress } from "../../../core/i18n/format";
import { deriveAccount } from "../../../core/wallet/keygen/mnemonic";
import {
  createTestGateways,
  fakeNavigation,
  renderWithProviders,
} from "../../../test/harness";
import { WalletImportScreen } from "./wallet-import-screen";

const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

async function renderImport(gateways = createTestGateways()) {
  const navigation = fakeNavigation();
  const view = await renderWithProviders(
    <WalletImportScreen navigation={navigation} route={fakeNavigation()} />,
    { gateways },
  );
  return { navigation, ...view, gateways };
}

describe("WalletImportScreen", () => {
  it("previews the derived address once the phrase is valid", async () => {
    await renderImport();
    const field = await screen.findByTestId("wallet-import-secret");
    expect(screen.queryByTestId("wallet-import-preview")).toBeNull();

    void fireEvent.changeText(field, PHRASE);
    expect(await screen.findByTestId("wallet-import-preview")).toBeTruthy();
    // 预览的是真实派生地址的缩写形式
    expect(
      screen.getByText(shortenAddress(deriveAccount(PHRASE, 0).address)),
    ).toBeTruthy();
  });

  it("imports a valid phrase and leaves the screen", async () => {
    const { navigation, gateways } = await renderImport();
    void fireEvent.changeText(
      await screen.findByTestId("wallet-import-secret"),
      PHRASE,
    );
    void fireEvent.press(await screen.findByTestId("wallet-import-submit"));
    await waitFor(() => expect(navigation.popToTop).toHaveBeenCalled());
    const accounts = await gateways.wallet.listAccounts();
    expect(accounts.map((item) => item.address)).toContain(
      deriveAccount(PHRASE, 0).address,
    );
  });

  it("shows progress immediately and ignores a second tap while importing", async () => {
    const gateways = createTestGateways();
    const importMnemonic = jest
      .spyOn(gateways.wallet, "importMnemonic")
      .mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return {
          address: deriveAccount(PHRASE, 0).address,
          label: "Imported",
          connector: "embedded",
          chains: ["eth"],
          current: false,
          backedUp: false,
        };
      });
    const { navigation, runtime } = await renderImport(gateways);
    void fireEvent.changeText(
      await screen.findByTestId("wallet-import-secret"),
      PHRASE,
    );
    const button = await screen.findByTestId("wallet-import-submit");

    await act(async () => {
      void fireEvent.press(button);
      void fireEvent.press(button);
      await Promise.resolve();
    });

    expect(importMnemonic).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(runtime.t("common.processing")),
    ).toBeTruthy();
    expect(button.props.accessibilityState).toEqual({
      busy: true,
      disabled: true,
    });

    await waitFor(() => expect(navigation.popToTop).toHaveBeenCalled());
  });

  it("explains an invalid phrase as soon as it is typed and refuses to submit", async () => {
    const { navigation, runtime } = await renderImport();
    void fireEvent.changeText(
      await screen.findByTestId("wallet-import-secret"),
      // 词都在词表里，但校验和错误
      PHRASE.replace(/about$/, "abandon"),
    );
    expect(
      await screen.findByText(runtime.t("wallet.import.invalidMnemonic")),
    ).toBeTruthy();
    expect(screen.queryByTestId("wallet-import-preview")).toBeNull();
    void fireEvent.press(await screen.findByTestId("wallet-import-submit"));
    expect(navigation.popToTop).not.toHaveBeenCalled();
  });

  it("switches to the private-key tab and imports a key", async () => {
    const { navigation, gateways, runtime } = await renderImport();
    void fireEvent.press(
      screen.getByText(runtime.t("wallet.import.tab.privateKey")),
    );
    const key = deriveAccount(PHRASE, 4).privateKey;
    void fireEvent.changeText(
      await screen.findByTestId("wallet-import-secret"),
      key,
    );
    void fireEvent.press(await screen.findByTestId("wallet-import-submit"));
    await waitFor(() => expect(navigation.popToTop).toHaveBeenCalled());
    const accounts = await gateways.wallet.listAccounts();
    expect(accounts.map((item) => item.address)).toContain(
      deriveAccount(PHRASE, 4).address,
    );
  });
});
