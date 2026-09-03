import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useGateways } from "../../../core/gateways/gateway-context";
import type { Money } from "../../../core/money/money";
import type { PlatformAgreement } from "../../../core/predict-platform/agreements";
import { PredictServiceNotConfiguredError } from "../../../core/predict-platform/config";
import { PredictPlatformMismatchError } from "../../../core/predict-platform/public-info";
import {
  PlatformHttpError,
  PlatformRateLimitedError,
} from "../../../core/predict-platform/tenant-client";
import {
  PredictNotEnabledError,
  type DepositAsset,
  type DepositStep,
  type EnablementStep,
} from "../api/account-gateway";

/** 与预测账户相关的查询键前缀：启用状态、余额、待领取、EOA 资金。 */
export const PREDICT_ACCOUNT_KEY = "predict-account";

/**
 * 重试策略（设计 §3.7）：配置错误（关联缺失、scopeId / chainId 不符、平台租户过期 403）
 * 与限流不重试——重试只会把错误配置打到别的租户上或撞限流；未启用是状态不是错误；
 * 其它（网络抖动）最多再试一次。
 */
function predictRetry(count: number, error: unknown): boolean {
  if (error instanceof PredictNotEnabledError) return false;
  if (error instanceof PredictServiceNotConfiguredError) return false;
  if (error instanceof PredictPlatformMismatchError) return false;
  if (error instanceof PlatformRateLimitedError) return false;
  if (error instanceof PlatformHttpError && error.status === 403) return false;
  return count < 1;
}

function useInvalidatePredictAccount() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: [PREDICT_ACCOUNT_KEY] });
    void queryClient.invalidateQueries({ queryKey: ["assets"] });
    void queryClient.invalidateQueries({ queryKey: ["wallet-balances"] });
  };
}

export function usePredictEnablement(address: string | undefined) {
  const { predictAccount } = useGateways();
  return useQuery({
    queryKey: [PREDICT_ACCOUNT_KEY, "enablement", address],
    queryFn: () => predictAccount.enablement(address as string),
    enabled: Boolean(address),
    staleTime: 15_000,
    retry: predictRetry,
  });
}

/** 四步启用；`step` 是正在进行的一步，供引导页显示进度。 */
export function useEnablePredict(address: string | undefined) {
  const { predictAccount } = useGateways();
  const invalidate = useInvalidatePredictAccount();
  const [step, setStep] = useState<EnablementStep | null>(null);
  const mutation = useMutation({
    mutationFn: () => predictAccount.enable(address as string, setStep),
    onSettled: () => {
      setStep(null);
      invalidate();
    },
  });
  return { ...mutation, step };
}

/** 余额；账户未启用时 `notEnabled` 为 true 而不是把它当成错误抛给界面。 */
export function usePredictAccountBalance(address: string | undefined) {
  const { predictAccount } = useGateways();
  const query = useQuery({
    queryKey: [PREDICT_ACCOUNT_KEY, "balance", address],
    queryFn: () => predictAccount.getBalance(address as string),
    enabled: Boolean(address),
    staleTime: 15_000,
    retry: predictRetry,
  });
  return {
    ...query,
    notEnabled: query.error instanceof PredictNotEnabledError,
  };
}

export function usePredictWalletFunds(address: string | undefined) {
  const { predictAccount } = useGateways();
  return useQuery({
    queryKey: [PREDICT_ACCOUNT_KEY, "funds", address],
    queryFn: () => predictAccount.walletFunds(address as string),
    enabled: Boolean(address),
    staleTime: 15_000,
    retry: predictRetry,
  });
}

export function useUnwrapTerms(enabled = true) {
  const { predictAccount } = useGateways();
  return useQuery({
    queryKey: [PREDICT_ACCOUNT_KEY, "unwrap-terms"],
    queryFn: () => predictAccount.unwrapTerms(),
    enabled,
    staleTime: 60_000,
    retry: predictRetry,
  });
}

export function useDepositQuote(
  address: string | undefined,
  input: { asset: DepositAsset; amount: Money } | undefined,
) {
  const { predictAccount } = useGateways();
  return useQuery({
    queryKey: [
      PREDICT_ACCOUNT_KEY,
      "deposit-quote",
      address,
      input?.asset,
      input?.amount.raw,
    ],
    queryFn: () =>
      predictAccount.quoteDeposit(
        address as string,
        input as { asset: DepositAsset; amount: Money },
      ),
    enabled: Boolean(address && input),
    staleTime: 15_000,
    retry: predictRetry,
  });
}

export function usePredictDeposit(address: string | undefined) {
  const { predictAccount } = useGateways();
  const invalidate = useInvalidatePredictAccount();
  const [step, setStep] = useState<DepositStep | null>(null);
  const mutation = useMutation({
    mutationFn: (input: { asset: DepositAsset; amount: Money }) =>
      predictAccount.deposit(address as string, input, setStep),
    onSettled: () => {
      setStep(null);
      invalidate();
    },
  });
  return { ...mutation, step };
}

export function usePredictWithdraw(address: string | undefined) {
  const { predictAccount } = useGateways();
  const invalidate = useInvalidatePredictAccount();
  return useMutation({
    mutationFn: (amount: Money) =>
      predictAccount.withdraw(address as string, amount),
    onSettled: invalidate,
  });
}

export function usePendingWithdrawals(
  address: string | undefined,
  enabled = true,
) {
  const { predictAccount } = useGateways();
  return useQuery({
    queryKey: [PREDICT_ACCOUNT_KEY, "pending-withdrawals", address],
    queryFn: () => predictAccount.listPendingWithdrawals(address as string),
    enabled: Boolean(address) && enabled,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: predictRetry,
  });
}

export function useClaimWithdrawal(address: string | undefined) {
  const { predictAccount } = useGateways();
  const invalidate = useInvalidatePredictAccount();
  return useMutation({
    mutationFn: (requestId: string) =>
      predictAccount.claimWithdrawal(address as string, requestId),
    onSettled: invalidate,
  });
}

export function usePredictAccountTx(id: string | undefined) {
  const { predictAccount } = useGateways();
  return useQuery({
    queryKey: [PREDICT_ACCOUNT_KEY, "tx", id],
    queryFn: () => predictAccount.getTx(id as string),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "confirmed" || status === "failed" ? false : 3_000;
    },
  });
}

export function usePlatformAgreements(enabled = true) {
  const { predictAccount } = useGateways();
  return useQuery({
    queryKey: [PREDICT_ACCOUNT_KEY, "agreements"],
    queryFn: () => predictAccount.agreements(),
    enabled,
    staleTime: 60_000,
    retry: predictRetry,
  });
}

export function useAcceptAgreements() {
  const { predictAccount } = useGateways();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (items: PlatformAgreement[]) =>
      predictAccount.acceptAgreements(items),
    onSettled: () =>
      void queryClient.invalidateQueries({
        queryKey: [PREDICT_ACCOUNT_KEY, "agreements"],
      }),
  });
}

export function useFaucet(address: string | undefined, enabled: boolean) {
  const { predictAccount } = useGateways();
  const invalidate = useInvalidatePredictAccount();
  const status = useQuery({
    queryKey: [PREDICT_ACCOUNT_KEY, "faucet", address],
    queryFn: () => predictAccount.faucetStatus(address as string),
    enabled: Boolean(address) && enabled,
    staleTime: 30_000,
  });
  const claim = useMutation({
    mutationFn: () => predictAccount.claimFaucet(address as string),
    onSettled: () => {
      void status.refetch();
      invalidate();
    },
  });
  return { status, claim };
}
