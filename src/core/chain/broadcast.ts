import type { ChainClient } from "./chain-client";
import { RpcError, RpcUnavailableError } from "./rpc-client";

/**
 * 节点说"这笔它已经知道了"的几种说法。第一个端点超时后换节点重发同一份 raw，
 * 第二个节点就会这么答——这是成功，不是失败。
 */
const ALREADY_KNOWN =
  /already known|known transaction|already exists|nonce too low|already imported/i;

/**
 * 广播，并把"结果不明"变成"确定"。
 *
 * 端点 A 收下了却没在超时前回话，客户端换到端点 B 重发同一份 raw，B 答
 * "already known"；或者所有端点都超时。这两种情况下交易很可能已经在链上，
 * 报成失败会诱导用户重试——第二笔就真的发出去了。所以结果不明时问一句节点
 * 认不认识这个 hash，认识就是成功。
 */
export async function broadcastResolved(
  chain: ChainClient,
  raw: string,
  expected: string,
): Promise<void> {
  try {
    const reported = await chain.broadcast(raw);
    if (reported?.toLowerCase() !== expected.toLowerCase())
      console.warn(
        `[chain] 节点返回的 txHash 与本地计算不一致，以本地为准：${reported}`,
      );
    return;
  } catch (error) {
    const ambiguous =
      error instanceof RpcUnavailableError ||
      (error instanceof RpcError && ALREADY_KNOWN.test(error.detail ?? ""));
    if (!ambiguous) throw error;
    const known = await chain.hasTransaction(expected).catch(() => false);
    if (!known) throw error;
    console.warn("[chain] 广播结果不明，但节点已认识这笔交易，按已提交处理");
  }
}
