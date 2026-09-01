import { RpcError, RpcUnavailableError, createRpcClient } from "./rpc-client";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("createRpcClient", () => {
  it("returns the result of a successful call", async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ jsonrpc: "2.0", id: 1, result: "0x2a" }),
    );
    const client = createRpcClient(["https://rpc.example"], { fetchImpl });

    await expect(client.call<string>("eth_blockNumber")).resolves.toBe("0x2a");
    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toMatchObject({
      jsonrpc: "2.0",
      method: "eth_blockNumber",
      params: [],
    });
  });

  it("falls back to the next endpoint when one is unreachable", async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(jsonResponse({ result: "0x1" }));
    const client = createRpcClient(
      ["https://down.example", "https://up.example"],
      { fetchImpl },
    );

    await expect(client.call<string>("eth_chainId")).resolves.toBe("0x1");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://up.example");
  });

  it("treats an http error as a reason to try the next endpoint", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, 429))
      .mockResolvedValueOnce(jsonResponse({ result: "0x1" }));
    const client = createRpcClient(["https://a.example", "https://b.example"], {
      fetchImpl,
    });

    await expect(client.call<string>("eth_chainId")).resolves.toBe("0x1");
  });

  it("does not retry an execution error on another node", async () => {
    // 合约 revert 换个节点结果一样，重试只是让用户多等一轮
    const fetchImpl = jest.fn(async () =>
      jsonResponse({
        error: { code: 3, message: "execution reverted: BEP20: no balance" },
      }),
    );
    const client = createRpcClient(["https://a.example", "https://b.example"], {
      fetchImpl,
    });

    await expect(client.call("eth_call", [{}])).rejects.toBeInstanceOf(
      RpcError,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps the node's wording in detail rather than in the message shown to users", async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({
        error: { code: 3, message: "execution reverted: BEP20: no balance" },
      }),
    );
    const client = createRpcClient(["https://a.example"], { fetchImpl });

    const error = await client.call("eth_call", [{}]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).code).toBe(3);
    expect((error as RpcError).detail).toContain("BEP20");
  });

  it("reports every endpoint answering with an http error as unavailable too", async () => {
    // 5xx / 限流的语义是"没连上"，界面该说"检查网络"，不是"节点拒绝了这笔交易"
    const fetchImpl = jest.fn(async () => jsonResponse({}, 502));
    const client = createRpcClient(["https://a.example", "https://b.example"], {
      fetchImpl,
    });

    await expect(client.call("eth_chainId")).rejects.toBeInstanceOf(
      RpcUnavailableError,
    );
  });

  it("reports every endpoint failing as unavailable, not as an rpc error", async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error("network down"));
    const client = createRpcClient(["https://a.example", "https://b.example"], {
      fetchImpl,
    });

    await expect(client.call("eth_chainId")).rejects.toBeInstanceOf(
      RpcUnavailableError,
    );
  });

  it("refuses to pretend it can work without endpoints", async () => {
    // 服务端还没下发 RPC 时不能猜一个公共节点：那等于把用户的查询交给未声明的第三方
    const client = createRpcClient([]);
    await expect(client.call("eth_chainId")).rejects.toBeInstanceOf(
      RpcUnavailableError,
    );
  });

  it("aborts a request that outlives the timeout", async () => {
    const fetchImpl = jest.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          );
        }),
    );
    const client = createRpcClient(["https://slow.example"], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 10,
    });

    await expect(client.call("eth_chainId")).rejects.toBeInstanceOf(
      RpcUnavailableError,
    );
    // 真的发出了 abort 信号，而不是只放弃等待、把连接留在后台
    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(init.signal?.aborted).toBe(true);
  });

  it("treats a missing result as a failure worth trying elsewhere", async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse({ jsonrpc: "2.0", id: 1 }))
      .mockResolvedValueOnce(jsonResponse({ result: "0x1" }));
    const client = createRpcClient(["https://a.example", "https://b.example"], {
      fetchImpl,
    });

    await expect(client.call<string>("eth_chainId")).resolves.toBe("0x1");
  });
});
