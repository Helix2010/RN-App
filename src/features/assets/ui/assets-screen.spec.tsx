import { fromDecimal } from "../../../core/money/money";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { CHAINS } from "../../../core/gateways/types";
import {
  createTestGateways,
  renderWithProviders,
  signIn,
} from "../../../test/harness";
import { AssetsScreen } from "./assets-screen";

function renderAssets(options: Parameters<typeof renderWithProviders>[1] = {}) {
  return renderWithProviders(
    <AssetsScreen
      onOpenAccount={jest.fn()}
      onOpenSend={jest.fn()}
      onOpenSwap={jest.fn()}
    />,
    options,
  );
}

describe("AssetsScreen", () => {
  it("gates guests behind the login prompt instead of showing an empty portfolio", async () => {
    await renderAssets();
    await waitFor(() =>
      expect(screen.getByTestId("assets-connect")).toBeTruthy(),
    );
    expect(screen.queryByTestId("assets-wallet")).toBeNull();
  });

  it("shows the predict account card and transfer action when Predict is on", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    await renderAssets({ gateways });
    await waitFor(() =>
      expect(screen.getByTestId("assets-predict")).toBeTruthy(),
    );
    expect(screen.getByTestId("assets-transfer")).toBeTruthy();
    expect(screen.queryByTestId("assets-swap")).toBeNull();
  });

  it("hides the predict account and swaps the third action when Predict is off", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    await renderAssets({ gateways, modules: { predict: false } });
    await waitFor(() =>
      expect(screen.getByTestId("assets-wallet")).toBeTruthy(),
    );
    expect(screen.queryByTestId("assets-predict")).toBeNull();
    expect(screen.getByTestId("assets-swap")).toBeTruthy();
    expect(screen.queryByTestId("assets-transfer")).toBeNull();
  });

  it("formats amounts as currency rather than raw minor units", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    await renderAssets({ gateways });
    // 千分位 + 两位小数；不断言货币符号（Node 的完整 ICU 与设备上的 Hermes 前缀不同）
    const amounts = await screen.findAllByText(/\d{1,3}(,\d{3})+\.\d{2}/);
    expect(amounts.length).toBeGreaterThan(0);
    expect(screen.queryByText(/^\d{7,}$/)).toBeNull();
  });
});

describe("AssetsScreen per-chain availability and pricing", () => {
  it("shows the chain notice and a partial total instead of an empty state when a chain is unavailable", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    gateways.wallet.getBalances = jest.fn(async () => ({
      items: [],
      unavailable: [{ chain: "bsc" as const, reason: "node" as const }],
    }));

    await renderAssets({ gateways, modules: { predict: false } });

    await waitFor(() =>
      expect(screen.getByTestId("chain-unavailable-bsc")).toBeTruthy(),
    );
    // 一条链读不到不是"暂无数据"；总额也不能装成精确数字
    expect(screen.queryByText("暂无数据")).toBeNull();
    expect(screen.getByTestId("assets-partial")).toBeTruthy();
  });

  it("renders a token without a reference price as — and keeps it visible", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    gateways.wallet.getBalances = jest.fn(async () => ({
      items: [
        {
          token: {
            chain: "bsc" as const,
            address: "0x000000000000000000000000000000000000bEEF",
            symbol: "CAKE",
            name: "CAKE",
            decimals: 18,
            displayDecimals: 4,
            logoColor: "#D1884F",
            verified: false,
          },
          amount: fromDecimal("12", 18, "CAKE"),
          usdValue: null,
          change24hPct: 0,
        },
      ],
      unavailable: [],
    }));

    await renderAssets({ gateways, modules: { predict: false } });

    // 先等总览到达（部分合计标出来），再看这一行的估值是"—"
    await waitFor(() =>
      expect(screen.getByTestId("assets-partial")).toBeTruthy(),
    );
    expect(screen.getByText("—")).toBeTruthy();
  });
});

describe("AssetsScreen chain information", () => {
  const holding = (chain: "bsc" | "eth", symbol: string) => ({
    token: {
      chain,
      address: `0x${symbol.toLowerCase().padEnd(40, "0")}`,
      symbol,
      name: symbol,
      decimals: 18,
      displayDecimals: 2,
      logoColor: "#26A17B",
      verified: false,
    },
    amount: fromDecimal("12", 18, symbol),
    usdValue: 12,
    change24hPct: 0,
  });

  it("labels each holding with its chain and filters the list by chain", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    gateways.wallet.getBalances = jest.fn(async () => ({
      items: [holding("bsc", "AAA"), holding("eth", "BBB")],
      unavailable: [],
    }));

    await renderAssets({ gateways, modules: { predict: false } });

    // 每一行都带链徽标 + 链全名：同一个符号在两条链上是两个资产
    await screen.findByTestId("chain-badge-bsc");
    expect(screen.getByTestId("chain-badge-eth")).toBeTruthy();
    expect(screen.getAllByText(CHAINS.eth.name).length).toBeGreaterThan(1);

    // 链筛选的第一个匹配是筛选条里的按钮（在列表上方）
    void fireEvent.press(screen.getAllByText(CHAINS.eth.name)[0]!);

    await waitFor(() => expect(screen.queryByText("AAA")).toBeNull());
    expect(screen.getByText("BBB")).toBeTruthy();
    expect(screen.queryByTestId("chain-badge-bsc")).toBeNull();
  });
});
