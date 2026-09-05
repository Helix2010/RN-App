import { useCallback, useEffect, useRef } from "react";
import { AppState, Modal, type AppStateStatus } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFoundationRuntime } from "../../app/runtime-context";
import { useTenantLogoUri } from "../../app/use-tenant-logo";
import {
  authenticate,
  biometricKind,
  isDeviceEnrolled,
  shouldLockOnResume,
  useAppLock,
  type BiometricKind,
} from "../../core/security/app-lock";
import { usePreferencesStore } from "../../core/preferences/preferences-store";
import {
  AppIcon,
  Body,
  BrandMark,
  InlineText,
  Page,
  Stack,
  type AppIconName,
} from "../../design-system";
import { useGateways } from "../../core/gateways/gateway-context";
import { useSession } from "../session/hooks/use-session";

const KIND_ICON: Record<BiometricKind, AppIconName> = {
  fingerprint: "fingerprint",
  face: "face-recognition",
  iris: "eye-outline",
  passcode: "lock-outline",
};

/**
 * 应用锁闸门：挂在导航器之上。开启且设备已录入生物识别 / 锁屏密码时，
 * 冷启动与"离开超过自动锁定时长"后回到前台都要求验证。
 * 设备未录入任何凭据时永不上锁——否则用户会被永久挡在门外。
 *
 * 锁屏没有"解锁"按钮：进入锁定态自动弹一次系统验证，用户取消后轻触中间的
 * 指纹 / 面容 / 密码图标重试。整页所有元素沿竖直中轴排列。
 */
export function AppLockGate() {
  const { t } = useFoundationRuntime();
  const insets = useSafeAreaInsets();
  const enabled = usePreferencesStore((state) => state.appLockEnabled);
  const autoLockMinutes = usePreferencesStore((state) => state.autoLockMinutes);
  const locked = useAppLock((state) => state.locked);
  const enrolled = useAppLock((state) => state.enrolled);
  const kind = useAppLock((state) => state.kind);
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
    void biometricKind().then((value) => {
      if (alive) useAppLock.getState().setKind(value);
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

  // 一进入锁定态就自动弹一次系统验证，用户取消后可轻触图标重试
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
      <Page
        alignItems="center"
        paddingTop={insets.top + 72}
        paddingBottom={insets.bottom + 40}
        paddingHorizontal="$6"
      >
        <Stack alignItems="center" gap="$3">
          <BrandMark size={64} uri={logoUri} />
          <InlineText fontSize={20} fontWeight="800" textAlign="center">
            {t("security.locked.title")}
          </InlineText>
        </Stack>
        <Stack flex={1} alignItems="center" justifyContent="center" gap="$4">
          <Stack
            width={112}
            height={112}
            borderRadius={56}
            backgroundColor="$surfaceVariant"
            borderWidth={1}
            borderColor={failed ? "$danger" : "$borderColor"}
            alignItems="center"
            justifyContent="center"
            onPress={() => void unlock()}
            accessibilityRole="button"
            accessibilityLabel={t("security.unlock")}
            pressStyle={{ opacity: 0.7, scale: 0.96 }}
            testID="app-lock-unlock"
          >
            <AppIcon
              name={KIND_ICON[kind]}
              size={56}
              colorToken={failed ? "danger" : "primary"}
            />
          </Stack>
          <Body
            fontSize={14}
            textAlign="center"
            color={failed ? "$danger" : "$textMuted"}
            maxWidth={280}
          >
            {failed
              ? t("security.unlock.failed")
              : t(`security.unlock.hint.${kind}`)}
          </Body>
        </Stack>
        <Body fontSize={12} textAlign="center" maxWidth={300}>
          {t("security.locked.subtitle")}
        </Body>
      </Page>
    </Modal>
  );
}
