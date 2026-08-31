import { useCallback } from "react";
import { useFoundationRuntime } from "../../app/runtime-context";
import { usePreferencesStore } from "../../core/preferences/preferences-store";
import { authenticate } from "../../core/security/app-lock";
import { toast } from "../../design-system";

export type VerificationRequest = {
  /** 本次操作的美元规模；超过大额阈值时即使关闭了"交易前验证"也要验证 */
  usdValue?: number;
  /** 系统弹窗上的说明文案，默认用通用文案 */
  reason?: string;
};

/**
 * 敏感操作前的身份验证：下单 / 兑换 / 划转 / 转出。
 * - 关闭"交易前验证"且未超大额阈值时直接放行；
 * - 设备没有生物识别 / 锁屏密码时放行（不能把用户卡死在一个无法满足的条件上）；
 * - 用户取消静默返回 false，验证失败给出 toast。
 */
export function useRequireVerification(): (
  request?: VerificationRequest,
) => Promise<boolean> {
  const { t } = useFoundationRuntime();
  return useCallback(
    async (request?: VerificationRequest) => {
      const prefs = usePreferencesStore.getState();
      const largeAmount =
        request?.usdValue !== undefined &&
        request.usdValue >= prefs.largeAmountThresholdUsd;
      if (!prefs.txConfirm && !largeAmount) return true;
      const outcome = await authenticate(
        request?.reason ?? t("security.verify.reason"),
      );
      if (outcome === "success" || outcome === "unavailable") return true;
      if (outcome === "failed") toast(t("security.verify.failed"), "error");
      return false;
    },
    [t],
  );
}
