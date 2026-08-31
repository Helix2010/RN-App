import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGateways } from "../../../core/gateways/gateway-context";
import type { ChainId, TokenRef } from "../../../core/gateways/types";
import type { CandleInterval, QuoteRequest, TokenQuery } from "../model/dex";

export function useDexTokens(query: TokenQuery) {
  const { dex } = useGateways();
  return useQuery({
    queryKey: ["dex-tokens", query],
    queryFn: () => dex.listTokens(query),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}

export function useDexToken(
  chain: ChainId | undefined,
  address: string | undefined,
) {
  const { dex } = useGateways();
  return useQuery({
    queryKey: ["dex-token", chain, address],
    queryFn: () => dex.getToken(chain as ChainId, address as string),
    enabled: Boolean(chain && address),
    staleTime: 10_000,
  });
}

export function useCandles(
  chain: ChainId | undefined,
  address: string | undefined,
  interval: CandleInterval,
) {
  const { dex } = useGateways();
  return useQuery({
    queryKey: ["dex-candles", chain, address, interval],
    queryFn: () =>
      dex.getCandles(chain as ChainId, address as string, interval),
    enabled: Boolean(chain && address),
    staleTime: 30_000,
  });
}

export function useDexTrades(
  chain: ChainId | undefined,
  address: string | undefined,
) {
  const { dex } = useGateways();
  return useQuery({
    queryKey: ["dex-trades", chain, address],
    queryFn: () => dex.listTrades(chain as ChainId, address as string),
    enabled: Boolean(chain && address),
    refetchInterval: 8_000,
  });
}

/** 报价：每 12s 过期，由页面按 expiresAt 倒计时并 refetch。 */
export function useQuote(request: QuoteRequest | null) {
  const { dex } = useGateways();
  return useQuery({
    queryKey: ["dex-quote", request],
    queryFn: () => dex.quote(request as QuoteRequest),
    enabled: Boolean(request && BigInt(request.amountIn.raw) > 0n),
    staleTime: 12_000,
  });
}

export function useApprove(address: string | undefined) {
  const { dex } = useGateways();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      token: TokenRef;
      spender: string;
      unlimited: boolean;
    }) =>
      dex.approve(
        address as string,
        input.token,
        input.spender,
        input.unlimited,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["dex-quote"] });
      void queryClient.invalidateQueries({ queryKey: ["dex-approvals"] });
    },
  });
}

export function useSwap(address: string | undefined) {
  const { dex } = useGateways();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (quoteId: string) => dex.swap(address as string, quoteId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["dex-swaps"] });
      void queryClient.invalidateQueries({ queryKey: ["wallet-balances"] });
      void queryClient.invalidateQueries({ queryKey: ["assets"] });
    },
  });
}

export function useSwapRecord(id: string | undefined) {
  const { dex } = useGateways();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["dex-swap", id],
    queryFn: async () => {
      const record = await dex.getSwap(id as string);
      if (
        record &&
        (record.status === "confirmed" || record.status === "failed")
      ) {
        void queryClient.invalidateQueries({ queryKey: ["wallet-balances"] });
        void queryClient.invalidateQueries({ queryKey: ["assets"] });
      }
      return record;
    },
    enabled: Boolean(id),
    refetchInterval: (query) =>
      query.state.data &&
      (query.state.data.status === "confirmed" ||
        query.state.data.status === "failed")
        ? false
        : 1_000,
  });
}

export function useSwaps(
  address: string | undefined,
  filter?: { status?: "pending" | "confirmed" | "failed"; chain?: ChainId },
) {
  const { dex } = useGateways();
  return useQuery({
    queryKey: ["dex-swaps", address, filter],
    queryFn: () => dex.listSwaps(address as string, filter),
    enabled: Boolean(address),
    refetchInterval: 3_000,
  });
}

export function useApprovals(address: string | undefined, chain?: ChainId) {
  const { dex } = useGateways();
  return useQuery({
    queryKey: ["dex-approvals", address, chain ?? "all"],
    queryFn: () => dex.listApprovals(address as string, chain),
    enabled: Boolean(address),
  });
}

export function useRevoke(address: string | undefined) {
  const { dex } = useGateways();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (approvalId: string) =>
      dex.revoke(address as string, approvalId),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["dex-approvals"] }),
  });
}
