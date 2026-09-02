import { screen } from "@testing-library/react-native";
import { renderWithProviders } from "../../../test/harness";
import { CHAINS } from "../../../core/gateways/types";
import {
  applyDeliveredWalletConfig,
  resetDeliveredWalletConfig,
} from "../../../core/wallet/config/wallet-runtime-config";
import { ReceiveSheet } from "./receive-sheet";

const ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const USDC_ETH = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

afterEach(() => resetDeliveredWalletConfig());

describe("ReceiveSheet", () => {
  it("offers only the chains the tenant enabled, and tags the testnet", async () => {
    // 账户支持 bsc/eth/op-sepolia，租户只开了 eth 与 op-sepolia：bsc 不能出现
    applyDeliveredWalletConfig({
      walletConnectProjectId: "p",
      chains: ["eth", "op-sepolia"],
    });

    await renderWithProviders(
      <ReceiveSheet address={ADDRESS} chains={["bsc", "eth", "op-sepolia"]} />,
    );

    expect(screen.queryByText(CHAINS.bsc.name)).toBeNull();
    expect(screen.getByText(CHAINS.eth.name)).toBeTruthy();
    expect(
      screen.getByText(new RegExp(`${CHAINS["op-sepolia"].name} · `)),
    ).toBeTruthy();
    expect(screen.queryByTestId("receive-testnet-notice")).toBeNull();
  });

  it("lists the delivered catalogue as the supported tokens", async () => {
    // 文案里的币种就是这条链上 App 会显示余额的那些，不能是写死的一份
    applyDeliveredWalletConfig({
      walletConnectProjectId: "p",
      chains: ["eth"],
      tokens: [
        {
          chain: "eth",
          address: "native",
          symbol: "ETH",
          name: "Ether",
          decimals: 18,
          displayDecimals: 4,
          logoColor: "#627EEA",
        },
        {
          chain: "eth",
          address: USDC_ETH,
          symbol: "USDC",
          name: "USD Coin",
          decimals: 6,
          displayDecimals: 2,
          logoColor: "#2775CA",
        },
      ],
    });

    await renderWithProviders(
      <ReceiveSheet address={ADDRESS} chains={["eth"]} />,
    );

    expect(screen.getByText(/ETH、USDC/)).toBeTruthy();
  });

  it("falls back to the native coin when an older server delivers no catalogue", async () => {
    applyDeliveredWalletConfig({
      walletConnectProjectId: "p",
      chains: ["bsc"],
    });

    await renderWithProviders(
      <ReceiveSheet address={ADDRESS} chains={["bsc"]} />,
    );

    // 链名本身也含 BNB，要盯住"支持 … 上的 BNB"这句
    expect(screen.getByText(/上的 BNB 及/)).toBeTruthy();
  });

  it("falls back to the tenant's chains when the account supports none of them", async () => {
    // EVM 地址在每条链上一样，收款不受账户快照的限制
    applyDeliveredWalletConfig({
      walletConnectProjectId: "p",
      chains: ["eth"],
    });

    await renderWithProviders(
      <ReceiveSheet address={ADDRESS} chains={["bsc"]} />,
    );

    expect(screen.getByText(CHAINS.eth.name)).toBeTruthy();
    expect(screen.queryByText(CHAINS.bsc.name)).toBeNull();
  });

  it("warns when the selected chain is a testnet", async () => {
    applyDeliveredWalletConfig({
      walletConnectProjectId: "p",
      chains: ["op-sepolia"],
    });

    await renderWithProviders(
      <ReceiveSheet address={ADDRESS} chains={["op-sepolia"]} />,
    );

    expect(screen.getByTestId("receive-testnet-notice")).toBeTruthy();
  });
});
