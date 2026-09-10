/**
 * 生产时钟。业务代码读"现在"只走这里，不直接调 `Date.now()`：
 * - 渲染期取时间必须经 `useNow`（./use-now.ts），满足 React 纯度规则；
 * - 测试用 `Date.now` spy 把它锚定到夹具日期（src/test/clock.ts），生产代码里没有任何 Mock 开关。
 */
export function now(): number {
  return Date.now();
}
