import { useQuery } from "@tanstack/react-query";
import { useFoundationRuntime } from "../../../app/runtime-context";
import { useGateways } from "../../../core/gateways/gateway-context";

/**
 * 我的邀请概览。
 *
 * 租户没开启邀请、或者还没登录时不查：查了也只会拿到 403 / 401，
 * 白白在界面上制造一个错误态。
 */
export function useReferralOverview(address: string | undefined) {
  const { referral } = useGateways();
  const { config } = useFoundationRuntime();
  return useQuery({
    queryKey: ["referral", "overview", address],
    queryFn: () => referral.overview(),
    enabled: config.referral.enabled && Boolean(address),
  });
}
