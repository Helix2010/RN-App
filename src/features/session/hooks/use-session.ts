import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { appRuntime } from "../../../core/network/api-client";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { useGateways } from "../../../core/gateways/gateway-context";
import type { SignInChallenge } from "../api/gateway";
import type { Session, WalletConnectorId } from "../model/session";
import type { WalletAccount } from "../../wallet/model/wallet";
import { WalletNotProvisionedError } from "../../wallet/api/gateway";

const sessionQueryKey = ["session"] as const;

export function useSession() {
  const { session } = useGateways();
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: () => session.get(),
    staleTime: Infinity,
  });
}

/**
 * 回到前台时向服务端确认会话。没有这一步，服务端撤销了令牌，App 仍会一直
 * 显示已登录到本地过期为止。
 */
export function useSessionRevalidation(): void {
  const { session } = useGateways();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!session.refresh) return;
    const revalidate = (): void => {
      void session.refresh?.().then((next) => {
        queryClient.setQueryData(sessionQueryKey, next);
        if (next === null)
          void queryClient.invalidateQueries({
            predicate: (query) => query.queryKey[0] !== "session",
          });
      });
    };
    // 挂载时就在前台，不必再看 AppState；之后只在回到前台时重校验
    revalidate();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") revalidate();
    });
    return () => subscription.remove();
  }, [queryClient, session]);
}

export function useSignOut() {
  const { session } = useGateways();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => session.signOut(),
    onSuccess: () => {
      queryClient.setQueryData(sessionQueryKey, null);
      // 清账户级缓存，保留游客可见数据（行情 / 市场）
      void queryClient.invalidateQueries({
        predicate: (query) =>
          [
            "positions",
            "orders",
            "balance",
            "activity",
            "wallet-balances",
            "assets",
          ].includes(String(query.queryKey[0])),
      });
    },
  });
}

/** SIWE domain：租户 API 域名（每个租户独立域名，签名消息绑定域名防重放）。 */
export function tenantDomain(): string {
  try {
    return new URL(appRuntime.apiBaseUrl).host || "localhost";
  } catch {
    return "localhost";
  }
}

export type LoginStep =
  | { step: "pick" }
  /** 本机还没有自托管钱包，UI 应引导去创建 / 导入 */
  | { step: "needs-wallet" }
  | { step: "connecting"; connector: WalletConnectorId }
  | {
      step: "confirm";
      account: WalletAccount;
      challenge: SignInChallenge;
      connector: WalletConnectorId;
    }
  | {
      step: "signing";
      account: WalletAccount;
      challenge: SignInChallenge;
      connector: WalletConnectorId;
    }
  | {
      step: "error";
      reason: "rejected" | "timeout" | "failed";
      account?: WalletAccount;
      challenge?: SignInChallenge;
      connector: WalletConnectorId;
    };

/**
 * 分步登录（L-02 → L-03）：connect 后停在确认层展示人话版 SIWE，sign 才发起签名。
 */
export function useWalletLogin(domain: string, signReason?: string) {
  const { session, wallet } = useGateways();
  const queryClient = useQueryClient();
  const [state, setState] = useState<LoginStep>({ step: "pick" });

  const connect = useCallback(
    async (connector: WalletConnectorId) => {
      setState({ step: "connecting", connector });
      try {
        const account = await wallet.connect(connector);
        const challenge = await session.challenge({
          address: account.address,
          connector,
          chains: account.chains,
          domain,
        });
        setState({ step: "confirm", account, challenge, connector });
      } catch (error) {
        if (error instanceof WalletNotProvisionedError) {
          setState({ step: "needs-wallet" });
          return;
        }
        setState({ step: "error", reason: "failed", connector });
      }
    },
    [domain, session, wallet],
  );

  const sign = useCallback(async (): Promise<Session | null> => {
    if (state.step !== "confirm" && state.step !== "error") return null;
    const { account, challenge, connector } = state;
    if (!account || !challenge) return null;
    setState({ step: "signing", account, challenge, connector });
    try {
      const signature = await wallet.signMessage(
        account.address,
        challenge.message,
        signReason ? { reason: signReason } : undefined,
      );
      const next = await session.verify(
        { address: account.address, connector, chains: account.chains, domain },
        challenge,
        signature,
      );
      queryClient.setQueryData(sessionQueryKey, next);
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== "session",
      });
      setState({ step: "pick" });
      return next;
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setState({
        step: "error",
        reason: /reject/i.test(message)
          ? "rejected"
          : /timeout/i.test(message)
            ? "timeout"
            : "failed",
        account,
        challenge,
        connector,
      });
      return null;
    }
  }, [domain, queryClient, session, signReason, state, wallet]);

  const reset = useCallback(() => setState({ step: "pick" }), []);
  return { state, connect, sign, reset };
}
