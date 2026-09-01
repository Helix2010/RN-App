import type { ChainClient } from "../../../core/chain/chain-client";
import { CHAINS, type ChainId } from "../../../core/gateways/types";
import { money } from "../../../core/money/money";
import type { WalletSigner } from "../../../core/wallet/signer/types";
import {
  applyDeliveredWalletConfig,
  resetDeliveredWalletConfig,
} from "../../../core/wallet/config/wallet-runtime-config";
import type { SendRequest } from "../model/wallet";
import { OnchainTransfers } from "./onchain-transfers";

const FROM = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const TO = "0x000000000000000000000000000000000000dEaD";
const USDT = "0x55d398326f99059ff775485246999027b3197955";

/** 只给 bsc 下发端点：另一条链要保持"未下发"以验证路由。 */
function deliverBscRpc(urls = ["https://bsc.example"]): void {
  applyDeliveredWalletConfig({
    walletConnectProjectId: "p",
    networks: [
      {
        id: "bsc",
        chainId: 56,
        rpcUrls: urls,
        explorerUrl: CHAINS.bsc.explorerUrl,
        testnet: false,
      },
      {
        id: "eth",
        chainId: 1,
        rpcUrls: [],
        explorerUrl: CHAINS.eth.explorerUrl,
        testnet: false,
      },
    ],
  });
}

function request(overrides: Partial<SendRequest> = {}): SendRequest {
  return {
    from: FROM,
    to: TO,
    token: {
      chain: "bsc" as ChainId,
      address: USDT,
      symbol: "USDT",
      name: "USDT",
      decimals: 18,
      logoColor: "#26A17B",
      verified: true,
    },
    amount: money(100n, 18, "USDT"),
    ...overrides,
  };
}

function fakeChain() {
  const receipts = new Map<string, { status: "success" | "reverted" }>();
  const chain = {
    getNativeBalance: jest.fn(async () => 10n ** 18n),
    getTokenBalances: jest.fn(
      async () => new Map([[USDT.toLowerCase(), 10n ** 20n]]),
    ),
    estimateGas: jest.fn(async () => 30_000n),
    getFeeData: jest.fn(async () => ({
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    })),
    getNextNonce: jest.fn(async () => 7),
    noteNonceUsed: jest.fn(),
    broadcast: jest.fn(async () => "0xdeadbeef"),
    getReceipt: jest.fn(async (hash: string) => receipts.get(hash) ?? null),
  };
  return { chain: chain as unknown as ChainClient, calls: chain, receipts };
}

function signer(): WalletSigner {
  return {
    address: FROM,
    managesOwnFees: false,
    signMessage: async () => "0x",
    signTypedData: async () => "0x",
    submitTransaction: async (_tx, _ctx, broadcast) => broadcast("0xraw"),
  };
}

afterEach(() => resetDeliveredWalletConfig());

describe("OnchainTransfers availability", () => {
  it("is unavailable until the server delivers an rpc endpoint", () => {
    // 下发本身就是灰度开关：没配端点的链不能悄悄用一个公共节点
    const onchain = new OnchainTransfers({ reason: "r" });
    expect(onchain.available("bsc")).toBe(false);
  });

  it("becomes available only for the chains that got endpoints", () => {
    deliverBscRpc();
    const onchain = new OnchainTransfers({ reason: "r" });
    expect(onchain.available("bsc")).toBe(true);
    expect(onchain.available("eth")).toBe(false);
  });
});

describe("OnchainTransfers send", () => {
  it("reports a broadcast as submitted, not as confirmed", async () => {
    // 广播成功≠上链成功；提前说"已确认"是在替链做保证
    deliverBscRpc();
    const { chain } = fakeChain();
    const onchain = new OnchainTransfers({
      reason: "r",
      createChain: () => chain,
    });

    const record = await onchain.send(request(), signer());

    expect(record.status).toBe("submitted");
    expect(record.hash).toBe("0xdeadbeef");
    expect(record.id).toBe("0xdeadbeef");
  });

  it("charges the fee in the chain's native coin, not in the token being sent", async () => {
    // nativeSymbol 写成被转的代币，"没 gas"的提示就会让用户去充错币
    deliverBscRpc();
    const { chain, calls } = fakeChain();
    calls.getNativeBalance.mockResolvedValue(0n);
    const onchain = new OnchainTransfers({
      reason: "r",
      createChain: () => chain,
    });

    const error = await onchain
      .send(request(), signer())
      .catch((e: unknown) => e);

    expect((error as { nativeSymbol?: string }).nativeSymbol).toBe("BNB");
  });

  it("refuses to guess an endpoint for a chain that got none", async () => {
    deliverBscRpc();
    const { chain } = fakeChain();
    const onchain = new OnchainTransfers({
      reason: "r",
      createChain: () => chain,
    });

    await expect(
      onchain.send(
        request({
          token: {
            chain: "eth",
            address: "native",
            symbol: "ETH",
            name: "ETH",
            decimals: 18,
            logoColor: "#627EEA",
            verified: true,
          },
        }),
        signer(),
      ),
    ).rejects.toThrow(/no rpc endpoint/);
  });

  it("rebuilds the client when the tenant's endpoints change", async () => {
    deliverBscRpc(["https://old.example"]);
    const created: string[][] = [];
    const { chain } = fakeChain();
    const onchain = new OnchainTransfers({
      reason: "r",
      createChain: (endpoints) => {
        created.push(endpoints);
        return chain;
      },
    });

    await onchain.send(request(), signer());
    await onchain.send(request(), signer());
    expect(created).toHaveLength(1);

    deliverBscRpc(["https://new.example"]);
    await onchain.send(request(), signer());

    // 租户换了节点之后继续用旧端点，等于配置改了却没生效
    expect(created).toEqual([["https://old.example"], ["https://new.example"]]);
  });
});

describe("OnchainTransfers quote", () => {
  it("quotes the fee in the native coin", async () => {
    deliverBscRpc();
    const { chain } = fakeChain();
    const onchain = new OnchainTransfers({
      reason: "r",
      createChain: () => chain,
    });

    const quote = await onchain.quote(request());

    expect(quote.fee).toEqual({
      raw: (30_000n * 1_000_000_000n).toString(),
      decimals: 18,
      symbol: "BNB",
    });
    // ERC-20 的手续费不从代币里扣，没有"全部转出"上限的概念
    expect(quote.maxAmount).toBeNull();
  });

  it("estimates with a dust amount so typing over the balance still gets a quote", async () => {
    // eth_estimateGas 在余额不足时 revert；照用户输入的金额估算，边输入边报错
    deliverBscRpc();
    const { chain, calls } = fakeChain();
    const onchain = new OnchainTransfers({
      reason: "r",
      createChain: () => chain,
    });

    await onchain.quote(request({ amount: money(10n ** 30n, 18, "USDT") }));

    const [call] = calls.estimateGas.mock.calls as unknown as [
      { data?: string },
    ][];
    expect(call?.[0]?.data).toContain("0".repeat(60) + "1");
  });

  it("subtracts the fee from a native max-amount", async () => {
    deliverBscRpc();
    const { chain, calls } = fakeChain();
    calls.getNativeBalance.mockResolvedValue(100_000n * 1_000_000_000n);
    const onchain = new OnchainTransfers({
      reason: "r",
      createChain: () => chain,
    });

    const quote = await onchain.quote(
      request({
        token: {
          chain: "bsc",
          address: "native",
          symbol: "BNB",
          name: "BNB",
          decimals: 18,
          logoColor: "#F0B90B",
          verified: true,
        },
        amount: money(1n, 18, "BNB"),
      }),
    );

    // 不扣手续费的"全部"必然失败，而用户会反复重试
    expect(quote.maxAmount?.raw).toBe((70_000n * 1_000_000_000n).toString());
  });
});

describe("OnchainTransfers progress", () => {
  it("stays confirming while the transaction has no receipt yet", async () => {
    deliverBscRpc();
    const { chain } = fakeChain();
    const onchain = new OnchainTransfers({
      reason: "r",
      createChain: () => chain,
    });

    await onchain.send(request(), signer());
    const tx = await onchain.getTransaction("0xdeadbeef");

    expect(tx?.status).toBe("confirming");
  });

  it("marks an on-chain revert as failed and says the fee was spent", async () => {
    deliverBscRpc();
    const { chain, receipts } = fakeChain();
    const onchain = new OnchainTransfers({
      reason: "r",
      createChain: () => chain,
    });

    await onchain.send(request(), signer());
    receipts.set("0xdeadbeef", { status: "reverted" });
    const tx = await onchain.getTransaction("0xdeadbeef");

    // revert 和"网络失败"完全不同：钱花了 gas 但没转成功
    expect(tx?.status).toBe("failed");
    expect(tx?.reasonKey).toBe("tx.reverted");
  });

  it("confirms once the receipt says success", async () => {
    deliverBscRpc();
    const { chain, receipts } = fakeChain();
    const onchain = new OnchainTransfers({
      reason: "r",
      createChain: () => chain,
    });

    await onchain.send(request(), signer());
    receipts.set("0xdeadbeef", { status: "success" });

    expect((await onchain.getTransaction("0xdeadbeef"))?.status).toBe(
      "confirmed",
    );
  });

  it("does not claim to know a hash it never submitted", async () => {
    // 返回 null 才能让网关回落去问 Mock 账本
    deliverBscRpc();
    const { chain } = fakeChain();
    const onchain = new OnchainTransfers({
      reason: "r",
      createChain: () => chain,
    });

    expect(await onchain.getTransaction("tx_mock_1")).toBeNull();
  });

  it("lists this session's on-chain sends for the address that made them", async () => {
    deliverBscRpc();
    const { chain } = fakeChain();
    const onchain = new OnchainTransfers({
      reason: "r",
      createChain: () => chain,
    });

    await onchain.send(request(), signer());

    // 不合并进历史，用户转完账回列表会以为这笔没发生
    expect(onchain.listTransfers(FROM)).toHaveLength(1);
    expect(onchain.listTransfers(FROM.toLowerCase())).toHaveLength(1);
    expect(onchain.listTransfers(TO)).toHaveLength(0);
  });
});
