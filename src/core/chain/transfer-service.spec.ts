import { Transaction, Wallet } from "ethers";
import { ChainClient } from "./chain-client";
import { RpcError, RpcUnavailableError } from "./rpc-client";
import {
  FeeChangedError,
  InsufficientBalanceError,
  InsufficientGasError,
  TransferGasAnomalyError,
  TransferService,
  type TransferRequest,
} from "./transfer-service";
import type { WalletSigner } from "../wallet/signer/types";

const FROM = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
/** 第 0 个派生地址就是 FROM：本地签名器要用真钥匙签，raw tx 才能算出 hash */
const PHRASE =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const TEST_WALLET = Wallet.fromPhrase(PHRASE);
const TO = "0x000000000000000000000000000000000000dEaD";
const USDT = "0x55d398326f99059ff775485246999027b3197955";

function request(overrides: Partial<TransferRequest> = {}): TransferRequest {
  return {
    from: FROM,
    to: TO,
    chainId: 56,
    tokenAddress: USDT,
    tokenSymbol: "USDT",
    nativeSymbol: "BNB",
    amount: 100n,
    ...overrides,
  };
}

type ChainStub = {
  nativeBalance: bigint;
  tokenBalance: bigint;
  gasLimit: bigint;
  maxFeePerGas: bigint;
  nonce: number;
};

function fakeChain(overrides: Partial<ChainStub> = {}) {
  const state: ChainStub = {
    nativeBalance: 10n ** 18n,
    tokenBalance: 1_000n,
    gasLimit: 30_000n,
    maxFeePerGas: 1_000_000_000n,
    nonce: 4,
    ...overrides,
  };
  const broadcast = jest.fn(async () => "0xhash");
  const noteNonceUsed = jest.fn();
  const chain = {
    getNativeBalance: jest.fn(async () => state.nativeBalance),
    getTokenBalances: jest.fn(
      async () => new Map([[USDT.toLowerCase(), state.tokenBalance]]),
    ),
    estimateGas: jest.fn(async () => state.gasLimit),
    getFeeData: jest.fn(async () => ({
      maxFeePerGas: state.maxFeePerGas,
      maxPriorityFeePerGas: state.maxFeePerGas,
    })),
    getNextNonce: jest.fn(async () => state.nonce),
    noteNonceUsed,
    broadcast,
    hasTransaction: jest.fn(async () => false),
  } as unknown as ChainClient;
  return { chain, broadcast, noteNonceUsed, state };
}

function localSigner() {
  const submitted: Parameters<WalletSigner["submitTransaction"]>[0][] = [];
  const signer: WalletSigner = {
    address: FROM,
    managesOwnFees: false,
    signMessage: async () => "0x",
    signTypedData: async () => "0x",
    submitTransaction: async (transaction, _context, broadcast) => {
      submitted.push(transaction);
      // 真的签：服务层要从 raw 里算 hash
      return broadcast(await TEST_WALLET.signTransaction(transaction));
    },
  };
  return { signer, submitted };
}

function externalSigner() {
  const submitted: Parameters<WalletSigner["submitTransaction"]>[0][] = [];
  const signer: WalletSigner = {
    address: FROM,
    managesOwnFees: true,
    signMessage: async () => "0x",
    signTypedData: async () => "0x",
    submitTransaction: async (transaction) => {
      submitted.push(transaction);
      return "0xwallethash";
    },
  };
  return { signer, submitted };
}

describe("TransferService with a local signer", () => {
  it("builds an ERC-20 transfer as a contract call, not a plain send", async () => {
    const { chain, broadcast } = fakeChain();
    const { signer, submitted } = localSigner();
    const service = new TransferService({ chain, reason: "r" });

    const result = await service.submit(request(), signer);

    const [raw] = broadcast.mock.calls[0] as unknown as [string];
    // hash 来自本地签名的原文，不是节点回答的 "0xhash"
    expect(result).toEqual({ hash: Transaction.from(raw).hash, nonce: 4 });
    const tx = submitted[0];
    // 收款地址在 calldata 里，to 是合约
    expect(tx?.to).toBe(USDT);
    expect(tx?.value).toBe(0n);
    expect(tx?.data?.startsWith("0xa9059cbb")).toBe(true);
    expect(raw.startsWith("0x02")).toBe(true); // EIP-1559 typed tx
  });

  it("sends a native transfer straight to the recipient", async () => {
    const { chain } = fakeChain();
    const { signer, submitted } = localSigner();
    const service = new TransferService({ chain, reason: "r" });

    await service.submit(
      request({ tokenAddress: "native", amount: 5n }),
      signer,
    );

    expect(submitted[0]?.to).toBe(TO);
    expect(submitted[0]?.value).toBe(5n);
    expect(submitted[0]?.data).toBeUndefined();
  });

  it("fills every field the guard requires", async () => {
    const { chain } = fakeChain();
    const { signer, submitted } = localSigner();
    await new TransferService({ chain, reason: "r" }).submit(request(), signer);

    expect(submitted[0]).toMatchObject({
      chainId: 56,
      nonce: 4,
      gasLimit: 30_000n,
      maxFeePerGas: 1_000_000_000n,
    });
  });

  it("claims the nonce only after the broadcast succeeded", async () => {
    const { chain, noteNonceUsed } = fakeChain();
    const { signer } = localSigner();
    const service = new TransferService({ chain, reason: "r" });

    await service.submit(request(), signer);
    expect(noteNonceUsed).toHaveBeenCalledWith(FROM, 4);
  });

  it("leaves the nonce reusable when the broadcast fails", async () => {
    const { chain, noteNonceUsed } = fakeChain();
    (chain.broadcast as jest.Mock).mockRejectedValue(new Error("node down"));
    const { signer } = localSigner();
    const service = new TransferService({ chain, reason: "r" });

    await expect(service.submit(request(), signer)).rejects.toThrow(
      "node down",
    );
    expect(noteNonceUsed).not.toHaveBeenCalled();
  });
});

describe("TransferService balance pre-checks", () => {
  it("names the token when its balance is short", async () => {
    const { chain } = fakeChain({ tokenBalance: 10n });
    const { signer } = localSigner();
    const service = new TransferService({ chain, reason: "r" });

    const error = await service
      .submit(request({ amount: 100n }), signer)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InsufficientBalanceError);
    expect((error as InsufficientBalanceError).symbol).toBe("USDT");
  });

  it("tells 'no gas' apart from 'no tokens'", async () => {
    // 最高频的用户困惑：有 USDT 但没有 BNB
    const { chain } = fakeChain({ nativeBalance: 0n, tokenBalance: 1_000n });
    const { signer } = localSigner();
    const service = new TransferService({ chain, reason: "r" });

    const error = await service
      .submit(request(), signer)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InsufficientGasError);
    expect((error as InsufficientGasError).nativeSymbol).toBe("BNB");
  });

  it("counts the fee against a native transfer's own balance", async () => {
    // 原生币转账时金额和手续费出自同一个余额
    const { chain } = fakeChain({ nativeBalance: 30_000n * 1_000_000_000n });
    const { signer } = localSigner();
    const service = new TransferService({ chain, reason: "r" });

    await expect(
      service.submit(request({ tokenAddress: "native", amount: 1n }), signer),
    ).rejects.toBeInstanceOf(InsufficientBalanceError);
  });

  it("never asks the node to estimate a transfer it knows is unfunded", async () => {
    // estimateGas 在余额不足时 revert，报文是合约内部话，不能给用户看——
    // 所以"有没有这么多币"必须在估算之前比
    const { chain } = fakeChain({ tokenBalance: 10n });
    const { signer } = localSigner();
    const service = new TransferService({ chain, reason: "r" });

    const error = await service
      .submit(request({ amount: 100n }), signer)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(InsufficientBalanceError);
    expect(chain.estimateGas).not.toHaveBeenCalled();
    expect(chain.getNextNonce).not.toHaveBeenCalled();
  });

  it("checks a native amount before estimating, then the fee on top", async () => {
    const { chain } = fakeChain({ nativeBalance: 5n });
    const { signer } = localSigner();
    const service = new TransferService({ chain, reason: "r" });

    await expect(
      service.submit(request({ tokenAddress: "native", amount: 10n }), signer),
    ).rejects.toBeInstanceOf(InsufficientBalanceError);
    expect(chain.estimateGas).not.toHaveBeenCalled();
  });
});

describe("TransferService gas ceiling", () => {
  it("refuses a token whose transfer would burn an absurd amount of gas", async () => {
    // 恶意代币可以把 transfer 写成烧光调用方给的全部 gas，原生币就全成了手续费
    const { chain } = fakeChain({ gasLimit: 2_000_000n });
    const { signer } = localSigner();
    const service = new TransferService({ chain, reason: "r" });

    const error = await service
      .submit(request(), signer)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TransferGasAnomalyError);
    expect(chain.getNextNonce).not.toHaveBeenCalled();
  });

  it("lets a fee-on-transfer token through", async () => {
    // 带反射 / 手续费逻辑的代币要 150k～200k，是正常范围
    const { chain } = fakeChain({ gasLimit: 200_000n });
    const { signer } = localSigner();
    const service = new TransferService({ chain, reason: "r" });

    await expect(service.submit(request(), signer)).resolves.toMatchObject({
      nonce: 4,
    });
  });
});

describe("TransferService broadcast outcome", () => {
  function nodeSays(detail: string) {
    return new RpcError("rpc error", -32000, detail);
  }

  it("treats 'already known' as success when the node has the transaction", async () => {
    // 端点 A 收下却超时，换到 B 重发同一份 raw：B 说已知道——这是成功，不是失败
    const { chain, noteNonceUsed } = fakeChain();
    (chain.broadcast as jest.Mock).mockRejectedValue(nodeSays("already known"));
    (chain.hasTransaction as jest.Mock).mockResolvedValue(true);
    const { signer } = localSigner();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const result = await new TransferService({ chain, reason: "r" }).submit(
      request(),
      signer,
    );

    expect(result.hash).toMatch(/^0x[0-9a-f]{64}$/);
    // 报成失败会诱导用户重试，第二笔就真的发出去了
    expect(noteNonceUsed).toHaveBeenCalledWith(FROM, 4);
    warn.mockRestore();
  });

  it("resolves an all-endpoints-timed-out broadcast the same way", async () => {
    const { chain } = fakeChain();
    (chain.broadcast as jest.Mock).mockRejectedValue(
      new RpcUnavailableError(2),
    );
    (chain.hasTransaction as jest.Mock).mockResolvedValue(true);
    const { signer } = localSigner();
    jest.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      new TransferService({ chain, reason: "r" }).submit(request(), signer),
    ).resolves.toMatchObject({ nonce: 4 });
  });

  it("does not invent a success the node cannot confirm", async () => {
    const { chain, noteNonceUsed } = fakeChain();
    (chain.broadcast as jest.Mock).mockRejectedValue(nodeSays("nonce too low"));
    (chain.hasTransaction as jest.Mock).mockResolvedValue(false);
    const { signer } = localSigner();

    await expect(
      new TransferService({ chain, reason: "r" }).submit(request(), signer),
    ).rejects.toBeInstanceOf(RpcError);
    expect(noteNonceUsed).not.toHaveBeenCalled();
  });

  it("still fails plainly on an error that is not ambiguous", async () => {
    const { chain } = fakeChain();
    (chain.broadcast as jest.Mock).mockRejectedValue(
      nodeSays("insufficient funds for gas * price + value"),
    );
    const { signer } = localSigner();

    await expect(
      new TransferService({ chain, reason: "r" }).submit(request(), signer),
    ).rejects.toBeInstanceOf(RpcError);
    expect(chain.hasTransaction).not.toHaveBeenCalled();
  });
});

describe("TransferService fee binding", () => {
  it("refuses to sign a fee far above what the user was quoted", async () => {
    // 报价和签名是两次独立询链：节点可以报价时报低、签名时报高
    const { chain } = fakeChain({ gasLimit: 30_000n, maxFeePerGas: 10n ** 9n });
    const { signer } = localSigner();
    const service = new TransferService({ chain, reason: "r" });
    const quoted = 10_000n * 10n ** 9n; // 用户看到的：远低于 30000 × 1 Gwei

    const error = await service
      .submit(request({ maxFeeWei: quoted }), signer)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FeeChangedError);
    expect(chain.getNextNonce).not.toHaveBeenCalled();
  });

  it("tolerates normal drift below a quarter", async () => {
    const { chain } = fakeChain({ gasLimit: 30_000n, maxFeePerGas: 10n ** 9n });
    const { signer } = localSigner();
    const service = new TransferService({ chain, reason: "r" });
    const quoted = (30_000n * 10n ** 9n * 10n) / 11n; // 实际比报价高约 10%

    await expect(
      service.submit(request({ maxFeeWei: quoted }), signer),
    ).resolves.toMatchObject({ nonce: 4 });
  });

  it("signs without a bound when none was given (external wallets show their own fee)", async () => {
    const { chain } = fakeChain();
    const { signer } = localSigner();
    await expect(
      new TransferService({ chain, reason: "r" }).submit(request(), signer),
    ).resolves.toMatchObject({ nonce: 4 });
  });
});

describe("TransferService with an external wallet", () => {
  it("checks the recipient in the orchestration layer, not only inside the signer", async () => {
    // 不依赖每个签名器实现自觉
    const { chain } = fakeChain();
    const { signer } = externalSigner();
    const service = new TransferService({ chain, reason: "r" });

    await expect(
      service.submit(
        request({
          tokenAddress: "native",
          to: "0x9858EfFD232B4033E47d90003D41EC34EcaEDA94",
        }),
        signer,
      ),
    ).rejects.toThrow(/收款地址不合法/);
  });

  it("hands over the intent without nonce or fees", async () => {
    const { chain } = fakeChain();
    const { signer, submitted } = externalSigner();
    const service = new TransferService({ chain, reason: "r" });

    const result = await service.submit(request(), signer);

    expect(result).toEqual({ hash: "0xwallethash" });
    expect(submitted[0]?.nonce).toBeUndefined();
    expect(submitted[0]?.maxFeePerGas).toBeUndefined();
    // 替钱包查 nonce 和 gas 是浪费，也可能和它自己的取值冲突
    expect(chain.getNextNonce).not.toHaveBeenCalled();
    expect(chain.getFeeData).not.toHaveBeenCalled();
  });
});

describe("TransferService serialisation", () => {
  it("runs two sends from one address one after the other", async () => {
    // 并发会拿到同一个 nonce：后一笔要么替换前一笔、要么一直卡着
    const { chain } = fakeChain();
    let inFlight = 0;
    let maxInFlight = 0;
    const signer: WalletSigner = {
      address: FROM,
      managesOwnFees: false,
      signMessage: async () => "0x",
      signTypedData: async () => "0x",
      submitTransaction: async (tx, _ctx, broadcast) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return broadcast(await TEST_WALLET.signTransaction(tx));
      },
    };
    const service = new TransferService({ chain, reason: "r" });

    await Promise.all([
      service.submit(request(), signer),
      service.submit(request(), signer),
    ]);

    expect(maxInFlight).toBe(1);
  });

  it("does not let a failed send block the next one", async () => {
    const { chain } = fakeChain();
    const { signer } = localSigner();
    (chain.broadcast as jest.Mock)
      .mockRejectedValueOnce(new Error("node down"))
      .mockResolvedValueOnce("0xsecond");
    const service = new TransferService({ chain, reason: "r" });

    const [first, second] = await Promise.allSettled([
      service.submit(request(), signer),
      service.submit(request(), signer),
    ]);

    expect(first.status).toBe("rejected");
    expect(second.status).toBe("fulfilled");
  });
});

describe("TransferService fee helpers", () => {
  it("quotes the fee so the UI can warn before the user signs", async () => {
    const { chain } = fakeChain();
    const service = new TransferService({ chain, reason: "r" });

    await expect(service.estimateFee(request())).resolves.toBe(
      30_000n * 1_000_000_000n,
    );
  });

  it("subtracts the fee from a native max-amount, or the send always fails", async () => {
    const { chain } = fakeChain({ nativeBalance: 100_000n * 1_000_000_000n });
    const service = new TransferService({ chain, reason: "r" });

    await expect(
      service.maxNativeAmount(request({ tokenAddress: "native" })),
    ).resolves.toBe(70_000n * 1_000_000_000n);
  });

  it("reports zero rather than a negative max when the fee exceeds the balance", async () => {
    const { chain } = fakeChain({ nativeBalance: 1n });
    const service = new TransferService({ chain, reason: "r" });

    await expect(
      service.maxNativeAmount(request({ tokenAddress: "native" })),
    ).resolves.toBe(0n);
  });
});
