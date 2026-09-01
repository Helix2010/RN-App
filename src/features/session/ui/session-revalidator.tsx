import { useSessionRevalidation } from "../hooks/use-session";

/**
 * 只跑会话重校验、不渲染任何东西。挂在导航器里（`GatewayProvider` 之内，
 * 因为运行时 Provider 在网关之上拿不到 session 网关）。
 */
export function SessionRevalidator(): null {
  useSessionRevalidation();
  return null;
}
