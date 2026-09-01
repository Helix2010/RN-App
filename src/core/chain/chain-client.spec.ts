import { Interface } from "ethers";
import { ChainClient } from "./chain-client";
import type { RpcClient } from "./rpc-client";

const ADDRESS = "0x9858EfFD232B4033E47d90003D41EC34EcaEda94";
const USDT = "0x55d398326f99059ff775485246999027b3197955";
const USDC = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d";

const multicall3 = new Interface([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) view returns ((bool success,bytes returnData)[] returnData)",
]);

function uint256(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

function stubRpc(handlers: Record<string, unknown>): {
  rpc: RpcClient;
  calls: { method: string; params: unknown[] }[];
} {
  const calls: { method: string; params: unknown[] }[] = [];
  const rpc: RpcClient = {
    async call<T>(method: string, params: unknown[] = []): Promise<T> {
      calls.push({ method, params });
      if (!(method in handlers)) throw new Error(`unstubbed ${method}`);
      const value = handlers[method];
      if (typeof value === "function")
        return (value as (p: unknown[]) => T)(params);
      return value as T;
    },
  };
  return { rpc, calls };
}

describe("ChainClient balances", () => {
  it("reads every token balance in a single request", async () => {
    const encoded = multicall3.encodeFunctionResult("aggregate3", [
      [
        [true, uint256(1_000n)],
        [true, uint256(2_500n)],
      ],
    ]);
    const { rpc, calls } = stubRpc({ eth_call: encoded });
    const client = new ChainClient(rpc);

    const balances = await client.getTokenBalances(ADDRESS, [USDT, USDC]);

    expect(calls.filter((c) => c.method === "eth_call")).toHaveLength(1);
    expect(balances.get(USDT.toLowerCase())).toBe(1_000n);
    expect(balances.get(USDC.toLowerCase())).toBe(2_500n);
  });

  it("skips a token whose call failed instead of dropping the whole batch", async () => {
    const encoded = multicall3.encodeFunctionResult("aggregate3", [
      [
        [false, "0x"],
        [true, uint256(7n)],
      ],
    ]);
    const { rpc } = stubRpc({ eth_call: encoded });

    const balances = await new ChainClient(rpc).getTokenBalances(ADDRESS, [
      USDT,
      USDC,
    ]);

    expect(balances.has(USDT.toLowerCase())).toBe(false);
    expect(balances.get(USDC.toLowerCase())).toBe(7n);
  });

  it("does not call the node at all for an empty token list", async () => {
    const { rpc, calls } = stubRpc({});
    await new ChainClient(rpc).getTokenBalances(ADDRESS, []);
    expect(calls).toHaveLength(0);
  });
});

describe("ChainClient nonce", () => {
  /** pending / latest 各自的取值 */
  function nonceStub(pending: string, latest: string) {
    return stubRpc({
      eth_getTransactionCount: (params: unknown[]) =>
        params[1] === "pending" ? pending : latest,
    });
  }

  it("asks for the pending count so two quick sends do not collide", async () => {
    const { rpc, calls } = nonceStub("0x5", "0x4");

    await expect(new ChainClient(rpc).getNextNonce(ADDRESS)).resolves.toBe(5);
    expect(calls.map((call) => call.params[1])).toEqual(
      expect.arrayContaining(["pending", "latest"]),
    );
  });

  it("refuses a pending nonce far ahead of the confirmed count", async () => {
    // 前面有空洞的交易永远不上链；采纳了这个值，之后每一笔都会卡在它后面
    const { rpc } = nonceStub("0x64", "0x4"); // 100 vs 4

    await expect(new ChainClient(rpc).getNextNonce(ADDRESS)).rejects.toThrow(
      /inconsistent nonce/,
    );
  });

  it("refuses a pending nonce below the confirmed count", async () => {
    const { rpc } = nonceStub("0x3", "0x4");

    await expect(new ChainClient(rpc).getNextNonce(ADDRESS)).rejects.toThrow(
      /inconsistent nonce/,
    );
  });

  it("does not let one bad node answer poison the local floor", async () => {
    // 本地下限只由真正用掉的 nonce 抬高；节点的值再大也只影响这一次
    let answers = { pending: "0x64", latest: "0x4" };
    const { rpc } = stubRpc({
      eth_getTransactionCount: (params: unknown[]) =>
        params[1] === "pending" ? answers.pending : answers.latest,
    });
    const client = new ChainClient(rpc);
    await expect(client.getNextNonce(ADDRESS)).rejects.toThrow();

    // 同一个 client，节点恢复正常：应得到 5，而不是被之前的 100 卡住
    answers = { pending: "0x5", latest: "0x5" };
    await expect(client.getNextNonce(ADDRESS)).resolves.toBe(5);
  });

  it("forgets a local floor after ten minutes, so a dropped transaction cannot strand the account", async () => {
    // 广播成功但随后被内存池丢掉：继续把它算在内会留下一个永远填不上的空洞
    let now = 1_000_000;
    const { rpc } = nonceStub("0x5", "0x5");
    const client = new ChainClient(rpc, { now: () => now });
    client.noteNonceUsed(ADDRESS, 9);
    await expect(client.getNextNonce(ADDRESS)).resolves.toBe(10);

    now += 11 * 60_000;
    await expect(client.getNextNonce(ADDRESS)).resolves.toBe(5);
  });

  it("rejects a quantity the node did not encode as hex", async () => {
    const { rpc } = stubRpc({ eth_getBalance: "1000" });
    await expect(
      new ChainClient(rpc).getNativeBalance(ADDRESS),
    ).rejects.toMatchObject({ name: "RpcError" });
    const empty = stubRpc({ eth_getBalance: "0x" });
    await expect(
      new ChainClient(empty.rpc).getNativeBalance(ADDRESS),
    ).rejects.toMatchObject({ name: "RpcError" });
  });

  it("refuses a nonce lower than one it already handed out", async () => {
    // 被篡改或落后的节点报一个更小的 nonce，会让用户签出重放旧交易的签名
    const { rpc } = nonceStub("0x2", "0x2");
    const client = new ChainClient(rpc);
    client.noteNonceUsed(ADDRESS, 8);

    await expect(client.getNextNonce(ADDRESS)).resolves.toBe(9);
  });

  it("tracks each address separately", async () => {
    const other = "0x000000000000000000000000000000000000dEaD";
    const { rpc } = nonceStub("0x1", "0x1");
    const client = new ChainClient(rpc);
    client.noteNonceUsed(ADDRESS, 20);

    await expect(client.getNextNonce(other)).resolves.toBe(1);
  });
});

describe("ChainClient fees", () => {
  it("uses baseFee doubled plus the tip", async () => {
    const { rpc } = stubRpc({
      eth_getBlockByNumber: { baseFeePerGas: "0x3b9aca00" }, // 1 Gwei
      eth_gasPrice: "0x3b9aca00",
      eth_maxPriorityFeePerGas: "0x5f5e100", // 0.1 Gwei
    });

    const fee = await new ChainClient(rpc).getFeeData();

    expect(fee.maxFeePerGas).toBe(2_100_000_000n);
    expect(fee.maxPriorityFeePerGas).toBe(100_000_000n);
  });

  it("degrades to the tip alone on a chain whose baseFee is zero", async () => {
    // BSC：EIP-1559 的结构在，baseFee 恒为 0，费用全来自 priority
    const { rpc } = stubRpc({
      eth_getBlockByNumber: { baseFeePerGas: "0x0" },
      eth_gasPrice: "0x2faf080",
      eth_maxPriorityFeePerGas: "0x2faf080",
    });

    const fee = await new ChainClient(rpc).getFeeData();

    expect(fee.maxFeePerGas).toBe(50_000_000n);
  });

  it("never goes below the reported gas price", async () => {
    // 报的 priority 低于网络实际接受的下限时，交易会永久 pending
    const { rpc } = stubRpc({
      eth_getBlockByNumber: {},
      eth_gasPrice: "0x3b9aca00",
      eth_maxPriorityFeePerGas: "0x1",
    });

    const fee = await new ChainClient(rpc).getFeeData();

    expect(fee.maxFeePerGas).toBe(1_000_000_000n);
  });

  it("works on a node that does not implement eth_maxPriorityFeePerGas", async () => {
    const { rpc } = stubRpc({
      eth_getBlockByNumber: { baseFeePerGas: "0x0" },
      eth_gasPrice: "0x3b9aca00",
      eth_maxPriorityFeePerGas: () => {
        throw new Error("method not found");
      },
    });

    await expect(new ChainClient(rpc).getFeeData()).resolves.toMatchObject({
      maxFeePerGas: 1_000_000_000n,
    });
  });

  it("does not pay a whole extra baseFee as tip when the node lacks eth_maxPriorityFeePerGas", async () => {
    // gasPrice 已经包含 baseFee；把它整个当小费等于每笔多付一个 baseFee
    const { rpc } = stubRpc({
      eth_getBlockByNumber: { baseFeePerGas: "0x2540be400" }, // 10 Gwei
      eth_gasPrice: "0x2e90edd00", // 12.5 Gwei
      eth_maxPriorityFeePerGas: () => {
        throw new Error("method not found");
      },
    });

    const fee = await new ChainClient(rpc).getFeeData();

    expect(fee.maxPriorityFeePerGas).toBe(2_500_000_000n);
  });

  it("refuses a fee far above the reported gas price", async () => {
    // 虚高的费用会把用户的原生币烧成手续费
    const { rpc } = stubRpc({
      eth_getBlockByNumber: { baseFeePerGas: "0x2540be400" }, // 10 Gwei
      eth_gasPrice: "0x3b9aca00", // 1 Gwei
      eth_maxPriorityFeePerGas: "0x3b9aca00",
    });

    await expect(new ChainClient(rpc).getFeeData()).rejects.toThrow(
      /exceeds .* the reported gas price/,
    );
  });
});

describe("ChainClient gas and receipts", () => {
  it("pads the gas estimate, because it moves with the recipient's state", async () => {
    const { rpc } = stubRpc({ eth_estimateGas: "0x5208" }); // 21000

    await expect(
      new ChainClient(rpc).estimateGas({ from: ADDRESS, to: USDT }),
    ).resolves.toBe(25_200n);
  });

  it("tells a chain revert apart from a transaction still in flight", async () => {
    const reverted = stubRpc({
      eth_getTransactionReceipt: {
        transactionHash: "0xhash",
        status: "0x0",
        blockNumber: "0x10",
      },
    });
    await expect(
      new ChainClient(reverted.rpc).getReceipt("0xhash"),
    ).resolves.toEqual({ status: "reverted", blockNumber: 16 });

    const pending = stubRpc({ eth_getTransactionReceipt: null });
    await expect(
      new ChainClient(pending.rpc).getReceipt("0xhash"),
    ).resolves.toBeNull();

    const ok = stubRpc({
      eth_getTransactionReceipt: {
        transactionHash: "0xHASH",
        status: "0x01",
        blockNumber: "0x11",
      },
    });
    await expect(new ChainClient(ok.rpc).getReceipt("0xhash")).resolves.toEqual(
      {
        status: "success",
        blockNumber: 17,
      },
    );
  });

  it("ignores a receipt that belongs to a different transaction", async () => {
    // 节点把别的交易的回执塞回来，界面会把一笔没发生的转账显示成已确认
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { rpc } = stubRpc({
      eth_getTransactionReceipt: {
        transactionHash: "0xother",
        status: "0x1",
        blockNumber: "0x11",
      },
    });

    await expect(new ChainClient(rpc).getReceipt("0xhash")).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("encodes an ERC-20 transfer with the standard selector", async () => {
    const data = ChainClient.transferData(ADDRESS, 1_000n);
    expect(data.startsWith("0xa9059cbb")).toBe(true);
  });
});
