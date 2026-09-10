import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { createTestGateways, renderWithProviders } from "../../../test/harness";
import {
  presentWalletConnectUri,
  useWalletConnectPairing,
} from "../../wallet/model/walletconnect-store";
import {
  WalletVaultCorruptedError,
  WalletVaultKeyMissingError,
} from "../../../core/wallet/vault/keystore-vault";
import { WalletRegistryCorruptedError } from "../../wallet/api/gateway";
import { useWalletLogin } from "./use-session";

function Probe() {
  const login = useWalletLogin("app.example");
  return (
    <>
      <Text onPress={() => void login.connect("walletconnect")}>connect</Text>
      <Text testID="step">{login.state.step}</Text>
    </>
  );
}

afterEach(() => useWalletConnectPairing.getState().dismiss());

describe("useWalletLogin and the pairing sheet", () => {
  it("closes the QR sheet once the wallet is connected", async () => {
    // 不收的话签名确认页会被压在二维码下面，用户得自己划掉
    const gateways = createTestGateways();
    gateways.wallet.connect = jest.fn(async () => {
      presentWalletConnectUri("wc:abc@2", "walletconnect", "scan");
      return {
        address: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
        label: "w",
        connector: "walletconnect" as const,
        chains: ["bsc" as const],
        current: true,
        backedUp: true,
      };
    });
    await renderWithProviders(<Probe />, { gateways });

    void fireEvent.press(screen.getByText("connect"));

    await waitFor(() =>
      expect(screen.getByTestId("step")).toHaveTextContent("confirm"),
    );
    expect(useWalletConnectPairing.getState().uri).toBeNull();
  });

  it("closes the QR sheet when the connection fails, so the error is visible", async () => {
    const gateways = createTestGateways();
    gateways.wallet.connect = jest.fn(async () => {
      presentWalletConnectUri("wc:abc@2", "walletconnect", "scan");
      throw new Error("wallet approval timeout");
    });
    await renderWithProviders(<Probe />, { gateways });

    void fireEvent.press(screen.getByText("connect"));

    await waitFor(() =>
      expect(screen.getByTestId("step")).toHaveTextContent("error"),
    );
    expect(useWalletConnectPairing.getState().uri).toBeNull();
  });
});

describe("useWalletLogin storage recovery", () => {
  function RecoveryProbe() {
    const login = useWalletLogin("app.example");
    return (
      <>
        <Text onPress={() => void login.connect("embedded")}>connect</Text>
        <Text testID="step">{login.state.step}</Text>
        <Text testID="reason">
          {login.state.step === "needs-recovery" ? login.state.reason : ""}
        </Text>
      </>
    );
  }

  it.each([
    ["a corrupted vault", () => new WalletVaultCorruptedError(), "corrupted"],
    [
      "a corrupted registry",
      () => new WalletRegistryCorruptedError(),
      "corrupted",
    ],
    [
      "a missing wrap key",
      () => new WalletVaultKeyMissingError("missing"),
      "key-missing",
    ],
    [
      "a replaced wrap key",
      () => new WalletVaultKeyMissingError("mismatch"),
      "key-missing",
    ],
  ] as const)(
    "enters needs-recovery instead of needs-wallet on %s",
    async (_label, makeError, reason) => {
      const gateways = createTestGateways();
      gateways.wallet.connect = jest.fn(async () => {
        throw makeError();
      });
      await renderWithProviders(<RecoveryProbe />, { gateways });

      void fireEvent.press(screen.getByText("connect"));

      await waitFor(() =>
        expect(screen.getByTestId("step")).toHaveTextContent("needs-recovery"),
      );
      expect(screen.getByTestId("reason")).toHaveTextContent(reason);
    },
  );
});
