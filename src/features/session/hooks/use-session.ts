import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { appRuntime } from "../../../core/network/api-client";
import { useCallback, useState } from "react";
import { useGateways } from "../../../core/gateways/gateway-context";
import type { SignInChallenge } from "../api/gateway";
import type { AuthIntent, Session, WalletConnectorId } from "../model/session";
import type { WalletAccount } from "../../wallet/model/wallet";

export const sessionQueryKey = ["session"] as const;

export function useSession() {
  const { session } = useGateways();
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: () => session.get(),
    staleTime: Infinity,
  });
}

/**
 * 登录流程：连接钱包 → 生成挑战 → 钱包签名 → 换会话。
 * 调用方传入 domain（来自 bootstrap 租户域名）。
 */
export function useSignIn(domain: string) {
  const { session, wallet } = useGateways();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (connector: WalletConnectorId): Promise<Session> => {
      const account = await wallet.connect(connector);
      const request = {
        address: account.address,
        connector,
        chains: account.chains,
        domain,
      };
      const challenge = await session.challenge(request);
      const signature = await wallet.signMessage(
        account.address,
        challenge.message,
      );
      return session.verify(request, challenge, signature);
    },
    onSuccess: (next) => {
      queryClient.setQueryData(sessionQueryKey, next);
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== "session",
      });
    },
  });
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

/**
 * 写操作门禁：未登录时记录意图并要求打开登录 sheet；登录成功后由页面回放意图。
 */
export function useRequireAuth() {
  const { data: session } = useSession();
  const [pendingIntent, setPendingIntent] = useState<AuthIntent | null>(null);
  const require = useCallback(
    (intent: AuthIntent, run: () => void): boolean => {
      if (session) {
        run();
        return true;
      }
      setPendingIntent(intent);
      return false;
    },
    [session],
  );
  const consumeIntent = useCallback((): AuthIntent | null => {
    const intent = pendingIntent;
    setPendingIntent(null);
    return intent;
  }, [pendingIntent]);
  return {
    session,
    isAuthenticated: Boolean(session),
    require,
    pendingIntent,
    consumeIntent,
    dismiss: () => setPendingIntent(null),
  };
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
export function useWalletLogin(domain: string) {
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
      } catch {
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
  }, [domain, queryClient, session, state, wallet]);

  const reset = useCallback(() => setState({ step: "pick" }), []);
  return { state, connect, sign, reset };
}
