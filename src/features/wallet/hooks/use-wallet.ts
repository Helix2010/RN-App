import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { useGateways } from "../../../core/gateways/gateway-context";
import type { ChainId, Tx } from "../../../core/gateways/types";
import type {
  SendRequest,
  WalletTransfer,
  WalletTransferFeed,
} from "../model/wallet";

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
      // 刚转出的地址要立刻出现在"最近转出"里。此前这里失效的是
      // ["wallet-transfers"]——没有任何查询用这个键
      void queryClient.invalidateQueries({
        queryKey: ["wallet-recent-recipients"],
      });
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

/**
 * 轮询一笔钱包转账直到终态。
 *
 * @param initial 提交时拿到的记录。作为 initialData 填进去，进度页从第一帧起就有
 *   数据；之后某次轮询失败也只是保留上一次的状态，而不是退回"还没签名"——
 *   一笔已经花了 gas 的真实交易在界面上倒退成没发生过，用户会再发一笔。
 */
export function useWalletTransfer(id: string | undefined, initial?: Tx) {
  const { wallet } = useGateways();
  return useQuery({
    queryKey: ["wallet-transfer", id],
    queryFn: () => wallet.getTransaction(id as string),
    enabled: Boolean(id),
    initialData: initial,
    // 标成"很旧"，挂上就立刻去链上问一次
    initialDataUpdatedAt: initial ? 0 : undefined,
    retry: 2,
    refetchInterval: (query) => {
      const data = query.state.data;
      // null = 查过了但谁都不认识这个 id，再问也不会有答案
      if (data === null) return false;
      const status = data?.status;
      if (status === "confirmed" || status === "failed") return false;
      // 已进入等待出块阶段就放慢：真链上出块要几秒，800ms 一次只是在撞节点限流
      return status === "confirming" ? 2_500 : 800;
    },
  });
}

/**
 * 记录页的数据：平台索引 ∪ 本机账本，按时间倒序，外加每链索引状态。
 * `refetchInterval` 给收款页轮询用（前台 15 秒一次，见 useIncomingTransferWatch）。
 */
export function useWalletTransferFeed(
  address: string | undefined,
  options?: { refetchInterval?: number | false },
) {
  const { wallet } = useGateways();
  return useQuery({
    queryKey: ["wallet-transfers", address],
    queryFn: async (): Promise<WalletTransferFeed> => {
      const feed = await wallet.transferFeed(address as string);
      return {
        ...feed,
        items: [...feed.items].sort((a, b) =>
          a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
        ),
      };
    },
    enabled: Boolean(address),
    staleTime: 15_000,
    refetchInterval: options?.refetchInterval ?? false,
  });
}

/**
 * 收款页开着时盯新入账：前台每 15 秒拉一次记录，出现没见过的收款就回调（toast）
 * 并刷新余额。`active=false` 时不轮询，但仍跟着共享缓存更新"已见过"的集合，
 * 免得下次打开收款页把旧记录当新收款报一遍。
 */
export function useIncomingTransferWatch(
  address: string | undefined,
  active: boolean,
  onArrival: (transfer: WalletTransfer) => void,
) {
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setForeground(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  const feed = useWalletTransferFeed(address, {
    refetchInterval: active && foreground ? 15_000 : false,
  });
  const queryClient = useQueryClient();
  const seen = useRef<Set<string> | null>(null);
  // 回调放 ref 里：调用方每次渲染都会传新函数，不能让它成为下面 effect 的依赖
  const arrival = useRef(onArrival);
  useEffect(() => {
    arrival.current = onArrival;
  });
  useEffect(() => {
    const items = feed.data?.items;
    if (!items) return;
    const receives = items.filter((item) => item.kind === "receive");
    if (seen.current === null) {
      seen.current = new Set(receives.map((item) => item.id));
      return;
    }
    const fresh = receives.filter((item) => !seen.current?.has(item.id));
    if (fresh.length === 0) return;
    for (const item of fresh) seen.current.add(item.id);
    if (!active) return;
    for (const item of fresh) arrival.current(item);
    void queryClient.invalidateQueries({ queryKey: ["wallet-balances"] });
    void queryClient.invalidateQueries({ queryKey: ["assets"] });
  }, [feed.data, active, queryClient]);
}

/** 最近转出过的地址（去重、按时间倒序、最多 5 条），供转出页快速选择。 */
export type RecentRecipient = { address: string; lastUsedAt: string };

export function useRecentRecipients(address: string | undefined) {
  const { wallet } = useGateways();
  return useQuery({
    queryKey: ["wallet-recent-recipients", address],
    queryFn: async (): Promise<RecentRecipient[]> => {
      const transfers = await wallet.listTransfers(address as string);
      const seen = new Map<string, RecentRecipient>();
      for (const transfer of transfers) {
        if (transfer.kind !== "send") continue;
        const key = transfer.counterparty.toLowerCase();
        const known = seen.get(key);
        if (!known || known.lastUsedAt < transfer.updatedAt)
          seen.set(key, {
            address: transfer.counterparty,
            lastUsedAt: transfer.updatedAt,
          });
      }
      return [...seen.values()]
        .sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : -1))
        .slice(0, 5);
    },
    enabled: Boolean(address),
    staleTime: 15_000,
  });
}
