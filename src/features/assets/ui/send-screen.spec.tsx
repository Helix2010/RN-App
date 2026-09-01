import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import {
  createTestGateways,
  renderWithProviders,
  signIn,
} from "../../../test/harness";
import { SendScreen } from "./send-screen";
import type { TokenBalance } from "../../wallet/model/wallet";
import { fromDecimal } from "../../../core/money/money";

const RECIPIENT = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const USDT_BSC = "0x55d398326f99059ff775485246999027b3197955";

function balance(overrides: {
  address: string;
  symbol: string;
  verified: boolean;
}): TokenBalance {
  return {
    token: {
      chain: "bsc",
      address: overrides.address,
      symbol: overrides.symbol,
      name: overrides.symbol,
      decimals: 18,
      logoColor: "#26A17B",
      verified: overrides.verified,
    },
    amount: fromDecimal("500", 18, overrides.symbol),
    usdValue: 500,
    change24hPct: 0,
  };
}

async function openConfirm(options: { verified: boolean }) {
  const gateways = createTestGateways();
  await signIn(gateways);
  gateways.wallet.getBalances = jest.fn(async () => [
    balance({
      address: USDT_BSC,
      symbol: "USDT",
      verified: options.verified,
    }),
  ]);
  const rendered = await renderWithProviders(
    <SendScreen onBack={jest.fn()} initialChain="bsc" />,
    { gateways },
  );

  void fireEvent.changeText(
    await screen.findByTestId("send-address"),
    RECIPIENT,
  );
  void fireEvent.changeText(await screen.findByTestId("send-amount"), "100");
  void fireEvent.press(await screen.findByTestId("send-submit"));
  return rendered;
}

describe("SendScreen confirmation", () => {
  it("shows the recipient in full, not shortened", async () => {
    // 剪贴板劫持伪造的地址首尾往往一致，缩略显示看不出差别，
    // 而这是用户签名前最后一次能看到目标的地方
    const { runtime } = await openConfirm({ verified: true });

    await waitFor(() =>
      expect(screen.getByTestId("send-confirm-address")).toHaveTextContent(
        RECIPIENT,
      ),
    );
    expect(screen.getByText(runtime.t("send.checkAddress"))).toBeTruthy();
  });

  it("shows the token contract address and the chain id", async () => {
    // 合约地址被换掉时符号完全一样，不显示它就等于没有防线
    await openConfirm({ verified: true });

    await waitFor(() => expect(screen.getByText(/USDT ·/)).toBeTruthy());
    expect(screen.getByText(new RegExp(USDT_BSC))).toBeTruthy();
    // 链名会重复（Base 和 Ethereum 的原生币都叫 ETH），chainId 不会
    expect(screen.getByText(/· 56$/)).toBeTruthy();
  });

  it("warns when the token is not on the verified list", async () => {
    const { runtime } = await openConfirm({ verified: false });

    await waitFor(() =>
      expect(
        screen.getByText(runtime.t("send.unverifiedWarning")),
      ).toBeTruthy(),
    );
  });

  it("stays quiet for a verified token", async () => {
    const { runtime } = await openConfirm({ verified: true });

    await waitFor(() => expect(screen.getByText(/USDT ·/)).toBeTruthy());
    expect(screen.queryByText(runtime.t("send.unverifiedWarning"))).toBeNull();
  });
});
