import { Wallet } from "ethers";
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
/** 第 0 个派生地址就是 FROM：要真签，服务层才能从 raw 算出 hash */
const TEST_WALLET = Wallet.fromPhrase(
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
);
const TO = "0x000000000000000000000000000000000000dEaD";
const USDT = "0x55d398326f99059ff775485246999027b3197955";

/** 只给 bsc 下发端点：另一条链要保持"未下发"以验证路由。 */
function deliverBscRpc(
  urls = ["https://bsc.example"],
  onchainSends = true,
): void {
  applyDeliveredWalletConfig({
    walletConnectProjectId: "p",
    onchainSends,
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
      displayDecimals: 2,
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
    submitTransaction: async (tx, _ctx, broadcast) =>
      broadcast(await TEST_WALLET.signTransaction(tx)),
  };
}

afterEach(() => resetDeliveredWalletConfig());

describe("OnchainTransfers availability", () => {
  it("is unavailable until the server delivers an rpc endpoint", () => {
    // 下发本身就是灰度开关：没配端点的链不能悄悄用一个公共节点
    const onchain = new OnchainTransfers({ reason: "r" });
    expect(onchain.available("bsc")).toBe(false);
  });

  it("stays on the demo ledger while the tenant has not opted in, even with endpoints", () => {
    // 没配过端点的租户也会拿到平台默认端点，所以端点不能当开关
    deliverBscRpc(["https://bsc.example"], false);
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
    // hash 由本地签名原文算出，不是节点回答的 0xdeadbeef
    expect(record.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(record.hash).not.toBe("0xdeadbeef");
    expect(record.id).toBe(record.hash);
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
            displayDecimals: 4,
            logoColor: "#627EEA",
            verified: true,
          },
        }),
        signer(),
      ),
    ).rejects.toThrow(/no rpc endpoint/);
  });

  it("picks up new endpoints without rebuilding the client", async () => {
    deliverBscRpc(["https://old.example"]);
    const getters: (() => string[])[] = [];
    const { chain } = fakeChain();
    const onchain = new OnchainTransfers({
      reason: "r",
      createChain: (endpoints) => {
        getters.push(endpoints);
        return chain;
      },
    });

    await onchain.send(request(), signer());
    deliverBscRpc(["https://new.example"]);
    await onchain.send(request(), signer());

    // 只建了一次（队列与 nonce 下限得以保留），但端点读到的是新的
    expect(getters).toHaveLength(1);
    expect(getters[0]?.()).toEqual(["https://new.example"]);
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
          displayDecimals: 4,
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

    const sent = await onchain.send(request(), signer());
    const tx = await onchain.getTransaction(sent.id);

    expect(tx?.status).toBe("confirming");
  });

  it("marks an on-chain revert as failed and says the fee was spent", async () => {
    deliverBscRpc();
    const { chain, receipts } = fakeChain();
    const onchain = new OnchainTransfers({
      reason: "r",
      createChain: () => chain,
    });

    const sent = await onchain.send(request(), signer());
    receipts.set(sent.id, { status: "reverted" });
    const tx = await onchain.getTransaction(sent.id);

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

    const sent = await onchain.send(request(), signer());
    receipts.set(sent.id, { status: "success" });

    expect((await onchain.getTransaction(sent.id))?.status).toBe("confirmed");
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

describe("OnchainTransfers token balances", () => {
  it("asks the chain for exactly the delivered contracts, in one call", async () => {
    deliverBscRpc();
    const { chain, calls } = fakeChain();
    const onchain = new OnchainTransfers({
      reason: "r",
      createChain: () => chain,
    });

    const balances = await onchain.tokenBalances("bsc", FROM, [USDT]);

    // 目录该问哪些是网关的事，这一层只负责把这批合约原样问链
    expect(calls.getTokenBalances).toHaveBeenCalledWith(FROM, [USDT]);
    expect(balances.get(USDT.toLowerCase())).toBe(10n ** 20n);
  });

  it("refuses to guess an endpoint for a chain that got none", async () => {
    deliverBscRpc();
    const { chain } = fakeChain();
    const onchain = new OnchainTransfers({
      reason: "r",
      createChain: () => chain,
    });

    await expect(onchain.tokenBalances("eth", FROM, [USDT])).rejects.toThrow(
      /no rpc endpoint/,
    );
  });
});
