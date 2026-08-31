import { useCallback } from "react";
import { useFoundationRuntime } from "../../app/runtime-context";
import { usePreferencesStore } from "../../core/preferences/preferences-store";
import { authenticate, useAppLock } from "../../core/security/app-lock";
import { toast } from "../../design-system";

/**
 * 应用锁开关。关闭属于降低安全等级的操作，必须先通过身份验证；开启不需要。
 * `enrolled` 为 false 表示本机没有生物识别 / 锁屏密码，锁不会真正生效，界面需要说明。
 */
export function useAppLockToggle(): {
  enrolled: boolean;
  toggle: (next: boolean) => Promise<void>;
} {
  const { t } = useFoundationRuntime();
  const enrolled = useAppLock((state) => state.enrolled);
  const toggle = useCallback(
    async (next: boolean) => {
      const prefs = usePreferencesStore.getState();
      if (!next && prefs.appLockEnabled) {
        const outcome = await authenticate(t("security.appLock.disableReason"));
        if (outcome === "failed") toast(t("security.verify.failed"), "error");
        if (outcome !== "success" && outcome !== "unavailable") return;
      }
      prefs.update({ appLockEnabled: next });
      if (!next) useAppLock.getState().unlock();
    },
    [t],
  );
  return { enrolled, toggle };
}
