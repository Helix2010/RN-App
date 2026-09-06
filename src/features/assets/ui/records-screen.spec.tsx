import { screen, waitFor } from "@testing-library/react-native";
import { money } from "../../../core/money/money";
import {
  createTestGateways,
  renderWithProviders,
  signIn,
} from "../../../test/harness";
import type { WalletTransferFeed } from "../../wallet/model/wallet";
import { RecordsScreen } from "./records-screen";

const token = {
  chain: "bsc" as const,
  address: "native",
  symbol: "BNB",
  name: "BNB",
  decimals: 18,
  displayDecimals: 4,
  logoColor: "#F0B90B",
  verified: true,
};

async function renderRecords(feed: WalletTransferFeed) {
  const gateways = createTestGateways();
  await signIn(gateways);
  jest.spyOn(gateways.wallet, "transferFeed").mockResolvedValue(feed);
  await renderWithProviders(
    <RecordsScreen initialTab="wallet" onBack={jest.fn()} />,
    { gateways, modules: { predict: false } },
  );
}

describe("RecordsScreen wallet tab", () => {
  it("explains per-chain index state and flags lagging chains", async () => {
    await renderRecords({
      items: [],
      hidden: 0,
      index: {
        bsc: { state: "unconfigured" },
        eth: {
          state: "idle",
          block: 100,
          headBlock: 101,
          time: "2026-09-06T05:11:00.000Z",
          lagSeconds: 24,
        },
        base: {
          state: "catching_up",
          block: 50,
          headBlock: 900,
          time: "2026-09-06T04:00:00.000Z",
          lagSeconds: 4260,
        },
      },
    });
    await waitFor(() =>
      expect(screen.getByTestId("records-index")).toBeTruthy(),
    );
    expect(screen.getByTestId("records-index-bsc")).toHaveTextContent(
      /未开启收款索引/,
    );
    expect(screen.getByTestId("records-index-bsc")).toHaveTextContent(
      /区块浏览器/,
    );
    expect(screen.getByTestId("records-index-eth")).toHaveTextContent(
      /已索引到/,
    );
    expect(screen.getByTestId("records-index-eth")).not.toHaveTextContent(
      /落后/,
    );
    expect(screen.getByTestId("records-index-base")).toHaveTextContent(
      /落后 71 分钟/,
    );
    expect(screen.getByTestId("records-empty")).toBeTruthy();
  });

  it("shows the index failure and marks unattributed receipts", async () => {
    await renderRecords({
      items: [
        {
          id: "bsc:gap-10:in:-1",
          kind: "receive",
          status: "confirmed",
          token,
          amount: money(2_000000000000000000n, 18, "BNB"),
          counterparty: "",
          updatedAt: "2026-09-06T05:00:00.000Z",
          blockTime: "2026-09-06T05:00:00.000Z",
          attribution: "unattributed",
        },
      ],
      hidden: 2,
      index: {},
      indexError: "network down",
    });
    await waitFor(() =>
      expect(screen.getByTestId("records-index-error")).toBeTruthy(),
    );
    expect(screen.getByTestId("records-index-error")).toHaveTextContent(
      /network down/,
    );
    expect(screen.getByTestId("records-index-hidden")).toHaveTextContent(
      /2 条记录/,
    );
    expect(screen.getByTestId("record-bsc:gap-10:in:-1")).toHaveTextContent(
      /来源待确认/,
    );
  });
});
