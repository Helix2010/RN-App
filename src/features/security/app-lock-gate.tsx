import { useCallback, useEffect, useRef } from "react";
import { AppState, Modal, type AppStateStatus } from "react-native";
import { useFoundationRuntime } from "../../app/runtime-context";
import { useTenantLogoUri } from "../../app/use-tenant-logo";
import {
  authenticate,
  isDeviceEnrolled,
  shouldLockOnResume,
  useAppLock,
} from "../../core/security/app-lock";
import { usePreferencesStore } from "../../core/preferences/preferences-store";
import {
  Body,
  BrandMark,
  InlineText,
  Page,
  PrimaryButton,
  Stack,
} from "../../design-system";
import { useGateways } from "../../core/gateways/gateway-context";
import { useSession } from "../session/hooks/use-session";

/**
 * 应用锁闸门：挂在导航器之上。开启且设备已录入生物识别 / 锁屏密码时，
 * 冷启动与"离开超过自动锁定时长"后回到前台都要求验证。
 * 设备未录入任何凭据时永不上锁——否则用户会被永久挡在门外。
 */
export function AppLockGate() {
  const { t } = useFoundationRuntime();
  const enabled = usePreferencesStore((state) => state.appLockEnabled);
  const autoLockMinutes = usePreferencesStore((state) => state.autoLockMinutes);
  const locked = useAppLock((state) => state.locked);
  const enrolled = useAppLock((state) => state.enrolled);
  const session = useSession();
  const { lockKeys } = useGateways();
  const signedIn = Boolean(session.data?.address);
  const logoUri = useTenantLogoUri();
  const failed = useAppLock((state) => state.lastAttemptFailed);
  /** 防重入用 ref；验证结果写进 zustand 而不是组件 state，
      这样自动弹窗的 effect 里不会出现同步 setState（级联渲染）。 */
  const prompting = useRef(false);
  /** 冷启动只判定一次，避免会话/偏好刷新时反复上锁 */
  const coldStartHandled = useRef(false);

  useEffect(() => {
    let alive = true;
    void isDeviceEnrolled().then((value) => {
      if (alive) useAppLock.getState().setEnrolled(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  // 冷启动：已登录 + 已开启 + 设备可验证时先锁住
  useEffect(() => {
    if (coldStartHandled.current) return;
    if (!signedIn || !enabled || !enrolled) return;
    coldStartHandled.current = true;
    lockKeys();
    useAppLock.getState().lock();
  }, [enabled, enrolled, lockKeys, signedIn]);

  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      const store = useAppLock.getState();
      if (next === "background" || next === "inactive") {
        if (!store.locked) store.noteBackgrounded();
        return;
      }
      if (next !== "active") return;
      const shouldLock = shouldLockOnResume({
        enabled: usePreferencesStore.getState().appLockEnabled && signedIn,
        autoLockMinutes: usePreferencesStore.getState().autoLockMinutes,
        backgroundedAt: store.backgroundedAt,
        nowMs: Date.now(),
        enrolled: store.enrolled,
      });
      if (shouldLock) {
        lockKeys();
        store.lock();
      } else store.clearBackgrounded();
    };
    const subscription = AppState.addEventListener("change", onChange);
    return () => subscription.remove();
  }, [autoLockMinutes, lockKeys, signedIn]);

  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    const outcome = await authenticate(t("security.locked.subtitle"));
    prompting.current = false;
    if (outcome === "success" || outcome === "unavailable") {
      useAppLock.getState().unlock();
      return;
    }
    if (outcome === "failed") useAppLock.getState().noteAttemptFailed();
  }, [t]);

  // 一进入锁定态就自动弹一次系统验证，用户取消后可点按钮重试
  useEffect(() => {
    if (locked) void unlock();
  }, [locked, unlock]);

  if (!locked) return null;

  return (
    <Modal
      visible
      animationType="fade"
      transparent={false}
      statusBarTranslucent
      onRequestClose={() => undefined}
      testID="app-lock-gate"
    >
      <Page alignItems="center" justifyContent="center" padding="$5" gap="$4">
        <BrandMark size={72} uri={logoUri} />
        <Stack alignItems="center" gap="$1.5">
          <InlineText fontSize={20} fontWeight="800">
            {t("security.locked.title")}
          </InlineText>
          <Body fontSize={13} textAlign="center">
            {failed
              ? t("security.unlock.failed")
              : t("security.locked.subtitle")}
          </Body>
        </Stack>
        <PrimaryButton
          width="100%"
          maxWidth={280}
          onPress={() => void unlock()}
          testID="app-lock-unlock"
        >
          {t("security.unlock")}
        </PrimaryButton>
      </Page>
    </Modal>
  );
}
