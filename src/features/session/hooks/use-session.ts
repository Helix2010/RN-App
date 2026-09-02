import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useWalletConnectPairing } from "../../wallet/model/walletconnect-store";
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
        // 令牌没了：网关已经清掉本地存储，连 session 一起失效重取，
        // 否则一个还在飞的 get() 落地后会把旧会话写回来
        if (next === null) void queryClient.invalidateQueries();
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
  const { session, predictAccount } = useGateways();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const current = queryClient.getQueryData(sessionQueryKey) as
        { address?: string } | null | undefined;
      await session.signOut();
      // 平台 JWT / CLOB 凭证跟着会话走：登出就丢掉，下次登录重新签
      if (current?.address)
        await predictAccount.forgetCredentials(current.address);
    },
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
            "predict-account",
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
      reason: "rejected" | "timeout" | "noChain" | "failed";
      account?: WalletAccount;
      challenge?: SignInChallenge;
      connector: WalletConnectorId;
    };

function reasonOf(
  error: unknown,
): "rejected" | "timeout" | "noChain" | "failed" {
  if (
    error instanceof Error &&
    error.name === "WalletConnectNoEnabledChainError"
  )
    return "noChain";
  const message = error instanceof Error ? error.message : "";
  if (/reject/i.test(message)) return "rejected";
  if (/timeout/i.test(message)) return "timeout";
  return "failed";
}

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
        // 连上了就收起二维码；不收的话签名确认页会被压在它下面，用户得自己划掉
        useWalletConnectPairing.getState().dismiss();
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
        // 超时 / 拒绝时也要收起：超时提示的 toast 会被还开着的二维码压住
        useWalletConnectPairing.getState().dismiss();
        // 和 sign 一样区分原因：连接阶段最常见的就是"用户没在钱包里点批准"，
        // 一律报 failed 的话用户不知道该重试还是该去钱包里看
        setState({ step: "error", reason: reasonOf(error), connector });
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
      setState({
        step: "error",
        reason: reasonOf(error),
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
