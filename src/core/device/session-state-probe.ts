/**
 * 心跳里的客户端登录态：只用于服务端与会话表对账（设计 §4.1 / §4.9），不参与任何判定。
 *
 * 登录态属于会话功能，core 不能反向依赖它，所以由会话网关在创建时注册一个探针；
 * 登录 / 登出 / 服务端撤销后调用 notify，运行时会立即补一次心跳把新状态报上去。
 * 没有注册探针（测试壳、Mock 网关）时心跳不带该字段，服务端记"未上报"。
 */
export type ReportedSessionState = "signed_in" | "signed_out";

type SessionStateProbe = () => Promise<ReportedSessionState>;
type Listener = () => void;

let probe: SessionStateProbe | null = null;
const listeners = new Set<Listener>();

export function setSessionStateProbe(next: SessionStateProbe | null): void {
  probe = next;
}

export async function probeSessionState(): Promise<ReportedSessionState | null> {
  if (!probe) return null;
  return probe();
}

export function onSessionStateChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifySessionStateChanged(): void {
  for (const listener of listeners) listener();
}
