/**
 * 刚创建的钱包，助记词从创建页交到备份页的一次性通道（安全评审 N36）。
 *
 * 为什么不用路由参数：React Navigation 会把参数留在导航状态里，而导航状态会
 * 被状态持久化、`navigation.getState()`、开发工具和崩溃上报读到——助记词一旦
 * 进去，就散落在这些地方。这里改成模块级的一次性存放：取走即清，进程内存活，
 * 不参与任何序列化。
 */

let pending: string | null = null;

/** 创建钱包后暂存助记词；同一时刻只可能有一份，新的覆盖旧的。 */
export function stashPendingPhrase(phrase: string): void {
  pending = phrase;
}

/** 取走暂存的助记词。取走即清，第二次调用返回 null。 */
export function takePendingPhrase(): string | null {
  const value = pending;
  pending = null;
  return value;
}

/** 放弃这次创建流程（用户中途退出）时清掉，别让它留到下一次。 */
export function clearPendingPhrase(): void {
  pending = null;
}
