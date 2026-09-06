import { apiClient } from "../../../core/network/api-client";
import { HttpWalletIndex, transferOf } from "./http-wallet-index";

jest.mock("../../../core/network/api-client", () => ({
  apiClient: { post: jest.fn(), get: jest.fn() },
  appRuntime: { apiBaseUrl: "https://api.example.com" },
}));

const get = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

const ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const USDC = {
  address: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7",
  symbol: "USDC",
  name: "USD Coin",
  decimals: 6,
  displayDecimals: 2,
  logoColor: "#2775CA",
};

function row(overrides: Partial<Parameters<typeof transferOf>[0]> = {}) {
  return {
    chain: "op-sepolia",
    direction: "in" as const,
    asset: "erc20" as const,
    contractAddress: USDC.address,
    amountRaw: "50000000",
    counterparty: "0x6d2cfc4a3b36963b3a201b77a45d88443a89c8d5",
    txHash: "0xebecc3814b",
    logIndex: 7,
    blockNumber: 48409920,
    blockTime: "2026-09-05T15:33:00.000Z",
    attribution: "tx" as const,
    token: USDC,
    ...overrides,
  };
}

function session(address: string | null) {
  return {
    get: async () =>
      address
        ? {
            address,
            connector: "embedded" as const,
            chains: ["op-sepolia" as const],
            expiresAt: "2099-01-01T00:00:00.000Z",
            signedInAt: "2026-01-01T00:00:00.000Z",
          }
        : null,
    authorization: async () => ({ Authorization: "Wallet e2e-token" }),
  };
}

beforeEach(() => get.mockReset());

describe("transferOf", () => {
  it("maps an incoming ERC-20 row to a confirmed receive with catalogue metadata", () => {
    const transfer = transferOf(row());
    expect(transfer).toMatchObject({
      id: "op-sepolia:0xebecc3814b:in:7",
      kind: "receive",
      status: "confirmed",
      hash: "0xebecc3814b",
      updatedAt: "2026-09-05T15:33:00.000Z",
      blockTime: "2026-09-05T15:33:00.000Z",
      attribution: "tx",
      counterparty: "0x6d2cfc4a3b36963b3a201b77a45d88443a89c8d5",
      amount: { raw: "50000000", decimals: 6, symbol: "USDC" },
      token: { chain: "op-sepolia", address: USDC.address, verified: false },
    });
  });

  it("maps native rows to the app's native sentinel and out rows to sends", () => {
    const transfer = transferOf(
      row({
        direction: "out",
        asset: "native",
        contractAddress: "native",
        token: { ...USDC, address: "native", symbol: "ETH", decimals: 18 },
      }),
    );
    expect(transfer?.kind).toBe("send");
    expect(transfer?.token.address).toBe("native");
    expect(transfer?.id).toBe("op-sepolia:0xebecc3814b:out:7");
  });

  it("gives unattributed rows a stable id without a hash", () => {
    const transfer = transferOf(
      row({
        attribution: "unattributed",
        txHash: "",
        logIndex: -1,
        counterparty: "",
      }),
    );
    expect(transfer?.id).toBe("op-sepolia:gap-48409920:in:-1");
    expect(transfer?.hash).toBeUndefined();
    expect(transfer?.attribution).toBe("unattributed");
  });

  it("refuses rows it cannot display rather than inventing a symbol", () => {
    expect(transferOf(row({ token: null }))).toBeNull();
    expect(transferOf(row({ chain: "solana" }))).toBeNull();
  });
});

describe("HttpWalletIndex", () => {
  it("follows the cursor, sends the session header and reports hidden rows", async () => {
    get
      .mockResolvedValueOnce({
        items: [row(), row({ token: null })],
        nextCursor: "page-2",
        index: {
          "op-sepolia": {
            state: "idle",
            block: 10,
            headBlock: 12,
            time: "2026-09-06T05:11:00.000Z",
            lagSeconds: 24,
          },
          solana: { state: "idle" },
        },
      })
      .mockResolvedValueOnce({
        items: [row({ direction: "out", logIndex: 8 })],
        nextCursor: null,
        // 第二页的 index 不采用：状态以第一页为准
        index: { "op-sepolia": { state: "stalled" } },
      });
    const index = new HttpWalletIndex({ session: session(ADDRESS) });
    const result = await index.list(ADDRESS.toLowerCase());

    expect(result.items.map((item) => item.id)).toEqual([
      "op-sepolia:0xebecc3814b:in:7",
      "op-sepolia:0xebecc3814b:out:8",
    ]);
    expect(result.hidden).toBe(1);
    expect(result.index).toEqual({
      "op-sepolia": {
        state: "idle",
        block: 10,
        headBlock: 12,
        time: "2026-09-06T05:11:00.000Z",
        lagSeconds: 24,
      },
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0]?.[0]).toBe(
      "/v1/mobile/wallet/transfers?limit=200",
    );
    expect(get.mock.calls[0]?.[2]).toEqual({
      headers: { Authorization: "Wallet e2e-token" },
    });
    expect(get.mock.calls[1]?.[0]).toBe(
      "/v1/mobile/wallet/transfers?limit=200&cursor=page-2",
    );
  });

  it("refuses to query for an address that is not the signed-in session", async () => {
    await expect(
      new HttpWalletIndex({ session: session(null) }).list(ADDRESS),
    ).rejects.toThrow(/signed-in session/);
    await expect(
      new HttpWalletIndex({
        session: session("0x000000000000000000000000000000000000dEaD"),
      }).list(ADDRESS),
    ).rejects.toThrow(/signed-in session/);
    expect(get).not.toHaveBeenCalled();
  });
});
