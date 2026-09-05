import { useCallback } from "react";
import { useFoundationRuntime } from "../../app/runtime-context";
import { useGateways } from "../../core/gateways/gateway-context";
import { usePreferencesStore } from "../../core/preferences/preferences-store";
import {
  RECENT_VERIFICATION_WINDOW_MS,
  authenticate,
  verifiedWithin,
} from "../../core/security/app-lock";
import { toast } from "../../design-system";

export type VerificationRequest = {
  /**
   * 本次操作的美元规模；超过大额阈值时不论策略都要验证。
   * null 表示这个币没有参考价、规模未知：无从判断是不是大额，一律验证。
   */
  usdValue?: number | null;
  /** 系统弹窗上的说明文案，默认用通用文案 */
  reason?: string;
};

/**
 * 敏感操作前的身份验证：下单 / 兑换 / 划转 / 转出。策略见 `TxVerificationPolicy`：
 * - `smart`：最近验证过（解锁 / 上一次操作 / 签名）就直接放行，只剩钱包签名那一道；
 * - `always`：每次先过系统验证，并把钱包密钥重新锁上，让随后的签名再验一次；
 * - `off`：不验证；
 * - 大额（或规模未知）不论策略都验证。
 * - 设备没有生物识别 / 锁屏密码时放行（不能把用户卡死在一个无法满足的条件上）；
 * - 用户取消静默返回 false，验证失败给出 toast。
 */
export function useRequireVerification(): (
  request?: VerificationRequest,
) => Promise<boolean> {
  const { t } = useFoundationRuntime();
  const { lockKeys } = useGateways();
  return useCallback(
    async (request?: VerificationRequest) => {
      const prefs = usePreferencesStore.getState();
      const largeAmount =
        request?.usdValue === null ||
        (request?.usdValue !== undefined &&
          request.usdValue >= prefs.largeAmountThresholdUsd);
      const policy = prefs.txVerification;
      if (!largeAmount) {
        if (policy === "off") return true;
        if (policy === "smart" && verifiedWithin(RECENT_VERIFICATION_WINDOW_MS))
          return true;
      }
      const outcome = await authenticate(
        request?.reason ?? t("security.verify.reason"),
      );
      if (outcome === "success" || outcome === "unavailable") {
        // 双重验证：系统验证过了还要让签名那一步再验，先把金库的解锁窗口关掉
        if (policy === "always") lockKeys();
        return true;
      }
      if (outcome === "failed") toast(t("security.verify.failed"), "error");
      return false;
    },
    [lockKeys, t],
  );
}
