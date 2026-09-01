import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGateways } from "../../../core/gateways/gateway-context";
import type { ChainId } from "../../../core/gateways/types";
import type { SendRequest } from "../model/wallet";

export function useWalletConnectors() {
  const { wallet } = useGateways();
  return useQuery({
    queryKey: ["wallet-connectors"],
    queryFn: () => wallet.listConnectors(),
    // 不能永久缓存：外部钱包的可用性取决于 bootstrap 下发的 projectId，
    // 而 bootstrap 是启动后才到的，缓存住就会一直显示"未启用"。
    staleTime: 30_000,
  });
}

export function useWalletAccounts() {
  const { wallet } = useGateways();
  return useQuery({
    queryKey: ["wallet-accounts"],
    queryFn: () => wallet.listAccounts(),
  });
}

export function useWalletBalances(
  address: string | undefined,
  chain?: ChainId,
) {
  const { wallet } = useGateways();
  return useQuery({
    queryKey: ["wallet-balances", address, chain ?? "all"],
    queryFn: () => wallet.getBalances(address as string, chain),
    enabled: Boolean(address),
    staleTime: 15_000,
  });
}

export function useSendToken() {
  const { wallet } = useGateways();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: SendRequest) => wallet.send(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["wallet-balances"] });
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
      void queryClient.invalidateQueries({ queryKey: ["wallet-transfers"] });
    },
  });
}

/**
 * 链上手续费预估。
 *
 * queryKey 刻意不含金额：预估用 1 wei 询链（见 OnchainTransfers.quote），
 * 结果与用户输入无关，跟着每次按键重查只是在撞节点限流。
 */
export function useTransferQuote(request: SendRequest | undefined) {
  const { wallet } = useGateways();
  return useQuery({
    queryKey: [
      "transfer-quote",
      request?.token.chain,
      request?.token.address,
      request?.from,
      // 收款地址也要进 key：给合约地址转账的 gas 比给普通地址高，换了收款人
      // 还用旧报价，确认页显示的手续费就是错的
      request?.to,
    ],
    queryFn: () => wallet.quoteTransfer(request as SendRequest),
    enabled: Boolean(request),
    staleTime: 15_000,
    // 节点抖一下就把手续费显示成"不可估"太吓人，但也不能一直重试
    retry: 1,
    retryDelay: 800,
  });
}

export function useSwitchAccount() {
  const { wallet, session } = useGateways();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (address: string) => {
      const account = await wallet.switchAccount(address);
      return account;
    },
    onSuccess: async () => {
      // 切换地址 = 需要重新签名登录；先登出，交给登录 sheet
      await session.signOut();
      queryClient.setQueryData(["session"], null);
      void queryClient.invalidateQueries();
    },
  });
}

/** 轮询一笔钱包转账直到终态。 */
export function useWalletTransfer(id: string | undefined) {
  const { wallet } = useGateways();
  return useQuery({
    queryKey: ["wallet-transfer", id],
    queryFn: () => wallet.getTransaction(id as string),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status === "confirmed" || status === "failed") return false;
      // 已进入等待出块阶段就放慢：真链上出块要几秒，800ms 一次只是在撞节点限流
      return status === "confirming" ? 2_500 : 800;
    },
  });
}
