import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { createTestGateways, renderWithProviders } from "../../../test/harness";
import { WalletVaultCorruptedError } from "../../../core/wallet/vault/keystore-vault";
import type { WalletAccount } from "../../wallet/model/wallet";
import { useAuthSheet } from "../model/auth-sheet-store";
import { ConnectWalletSheet } from "./connect-wallet-sheet";

const EMBEDDED: WalletAccount = {
  address: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
  label: "Wallet 1",
  connector: "embedded",
  chains: ["bsc"],
  current: true,
  backedUp: true,
};

afterEach(() => useAuthSheet.getState().close());

describe("ConnectWalletSheet recovery panel", () => {
  it("shows the recovery panel instead of create/import when the vault is broken, and uses the recovery result", async () => {
    const gateways = createTestGateways();
    gateways.wallet.listAccounts = jest.fn(async () => [EMBEDDED]);
    gateways.wallet.connect = jest.fn(async () => {
      throw new WalletVaultCorruptedError();
    });
    const recoverStorage = jest.fn(async () => ({
      vaultArchived: false,
      registryArchived: true,
    }));
    gateways.wallet.recoverStorage = recoverStorage;
    useAuthSheet.getState().requestAuth();
    await renderWithProviders(<ConnectWalletSheet />, { gateways });

    // 已有内置钱包 → 这一行是"使用钱包"，点它走 connect("embedded")
    await waitFor(() =>
      expect(screen.getByTestId("login-create")).toBeTruthy(),
    );
    void fireEvent.press(screen.getByTestId("login-create"));

    await waitFor(() =>
      expect(screen.getByTestId("login-recovery")).toBeTruthy(),
    );
    // 恢复面板不提供"创建钱包"：那会覆盖唯一的一份数据
    expect(screen.queryByTestId("login-import")).toBeNull();

    void fireEvent.press(screen.getByTestId("login-recovery-import"));
    await waitFor(() =>
      expect(recoverStorage).toHaveBeenCalledWith("wallet.recovery.authReason"),
    );
    // 只归档了注册表：钱包密钥完好，不跳导入页，面板收起回到选择器
    await waitFor(() =>
      expect(screen.queryByTestId("login-recovery")).toBeNull(),
    );
  });
});
