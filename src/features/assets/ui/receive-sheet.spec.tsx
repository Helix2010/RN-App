import { screen } from "@testing-library/react-native";
import { renderWithProviders } from "../../../test/harness";
import { withWallet } from "../../../test/wallet-config";
import { CHAINS } from "../../../core/gateways/types";
import { ReceiveSheet } from "./receive-sheet";

const ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const USDC_ETH = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

describe("ReceiveSheet", () => {
  it("offers only the chains the tenant enabled, and tags the testnet", async () => {
    // 账户支持 bsc/eth/op-sepolia，租户只开了 eth 与 op-sepolia：bsc 不能出现
    await renderWithProviders(
      <ReceiveSheet address={ADDRESS} chains={["bsc", "eth", "op-sepolia"]} />,
      { config: (c) => withWallet(c, { chains: ["eth", "op-sepolia"] }) },
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
    await renderWithProviders(
      <ReceiveSheet address={ADDRESS} chains={["eth"]} />,
      {
        config: (c) =>
          withWallet(c, {
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
          }),
      },
    );

    expect(screen.getByText(/上的 ETH、USDC 及/)).toBeTruthy();
  });

  it("lists just the native coin when the catalogue has nothing else on the chain", async () => {
    // 启用的链一定有原生币条目（服务端保证）；目录里只有它时文案就只提它
    await renderWithProviders(
      <ReceiveSheet address={ADDRESS} chains={["bsc"]} />,
      { config: (c) => withWallet(c, { chains: ["bsc"] }) },
    );

    expect(screen.getByText(/上的 BNB 及/)).toBeTruthy();
  });

  it("shows no address when the account supports none of the enabled chains", async () => {
    // 不退到别的链：这个账户在这个平台上就是没有可收款的网络
    await renderWithProviders(
      <ReceiveSheet address={ADDRESS} chains={["bsc"]} />,
      {
        config: (c) => withWallet(c, { chains: ["eth"] }),
      },
    );

    expect(screen.getByTestId("receive-no-chain")).toBeTruthy();
    expect(screen.queryByText(ADDRESS)).toBeNull();
    expect(screen.queryByTestId("receive-copy")).toBeNull();
  });

  it("warns when the selected chain is a testnet", async () => {
    await renderWithProviders(
      <ReceiveSheet address={ADDRESS} chains={["op-sepolia"]} />,
      { config: (c) => withWallet(c, { chains: ["op-sepolia"] }) },
    );

    expect(screen.getByTestId("receive-testnet-notice")).toBeTruthy();
  });
});
