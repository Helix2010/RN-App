import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useGateways } from "../../../core/gateways/gateway-context";
import type { ChainId } from "../../../core/gateways/types";
import type { SendRequest } from "../model/wallet";

export function useWalletConnectors() {
  const { wallet } = useGateways();
  return useQuery({
    queryKey: ["wallet-connectors"],
    queryFn: () => wallet.listConnectors(),
    staleTime: Infinity,
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

export function useWalletTransfers(address: string | undefined) {
  const { wallet } = useGateways();
  return useQuery({
    queryKey: ["wallet-transfers", address],
    queryFn: () => wallet.listTransfers(address as string),
    enabled: Boolean(address),
    refetchInterval: 2_000,
  });
}
