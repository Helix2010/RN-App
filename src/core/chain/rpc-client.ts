/**
 * EVM JSON-RPC 客户端。
 *
 * 为什么不用 ethers 的 `JsonRpcProvider`：它自带重连、区块轮询和事件订阅，在移动端
 * 会在后台持续唤醒网络；我们只需要"发一个请求、拿到结果或明确失败"。编解码仍然用
 * ethers（`Interface` / `AbiCoder`），那部分是纯函数。
 *
 * 节点是**不可信**的：它可以返回任意数据、超时、限流。所以这里只做三件事——超时、
 * 多端点回退、把错误归一化成可判断的类型。语义校验（余额够不够、nonce 合不合理）
 * 属于调用方。
 */

export class RpcError extends Error {
  constructor(
    message: string,
    /** JSON-RPC 的 error.code；网络层失败时为 undefined */
    readonly code?: number,
    /** 节点原文，用于日志；**不要直接展示给用户** */
    readonly detail?: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

export class RpcUnavailableError extends Error {
  constructor(readonly attempts: number) {
    super(`no rpc endpoint answered after ${attempts} attempts`);
    this.name = "RpcUnavailableError";
  }
}

export type RpcClient = {
  call<T>(method: string, params?: unknown[]): Promise<T>;
};

type RpcClientOptions = {
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 12_000;

type JsonRpcResponse<T> = {
  result?: T;
  error?: { code?: number; message?: string };
};

/**
 * @param source 服务端下发的 RPC 列表，或每次调用时返回它的函数；按顺序尝试，
 *   前一个失败就换下一个。顺序是有意义的：租户自配的端点通常比公共节点可靠，
 *   应该排在前面。
 *
 *   传函数是为了让端点**实时生效而不必重建客户端**：客户端上面挂着每个地址的
 *   发送队列和 nonce 下限，为了换端点把它们丢掉，在途的那笔和下一笔就会并发，
 *   拿到同一个 nonce。
 */
export function createRpcClient(
  source: string[] | (() => string[]),
  options: RpcClientOptions = {},
): RpcClient {
  const endpointsNow = () => (typeof source === "function" ? source() : source);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const doFetch = options.fetchImpl ?? fetch;
  let requestId = 0;

  async function once<T>(
    endpoint: string,
    method: string,
    params: unknown[],
  ): Promise<T> {
    // AbortController 而不是 Promise.race：超时后要真的把请求取消掉，
    // 否则移动网络下会攒下一堆没人等的连接
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: (requestId += 1),
          method,
          params,
        }),
        signal: controller.signal,
      });
      if (!response.ok)
        throw new RpcError(`rpc http ${response.status}`, undefined, endpoint);
      const body = (await response.json()) as JsonRpcResponse<T>;
      if (body.error) {
        // 节点的报文可能含合约 revert 原文，留给调用方映射成用户看得懂的话
        throw new RpcError(
          body.error.message ?? "rpc error",
          body.error.code,
          body.error.message,
        );
      }
      if (body.result === undefined)
        throw new RpcError("rpc returned no result", undefined, endpoint);
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async call<T>(method: string, params: unknown[] = []): Promise<T> {
      const endpoints = endpointsNow();
      if (endpoints.length === 0) throw new RpcUnavailableError(0);
      for (const endpoint of endpoints) {
        try {
          return await once<T>(endpoint, method, params);
        } catch (error) {
          // 合约 revert 之类的**执行错误换个节点也一样**，别浪费一轮重试
          if (error instanceof RpcError && error.code !== undefined)
            throw error;
        }
      }
      // 走到这里说明每个端点都没给出带 code 的 JSON-RPC 错误：HTTP 5xx、超时、
      // 空响应……语义都是"没连上"，界面要说"检查网络"，而不是"节点拒绝了这笔交易"
      throw new RpcUnavailableError(endpoints.length);
    },
  };
}
