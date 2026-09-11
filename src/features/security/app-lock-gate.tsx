import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, AppState, Modal, type AppStateStatus } from "react-native";
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
import { enableAppSwitcherProtection } from "../../core/security/screen-protect";
import { usePreferencesStore } from "../../core/preferences/preferences-store";
import {
  AppIcon,
  Body,
  BrandMark,
  InlineText,
  Page,
  PrimaryButton,
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
 * 锁屏进入锁定态自动弹一次系统验证；用户取消后可轻触中间的图标，或点底部
 * "使用指纹解锁"按钮重试。页面刻意克制：图标不加任何底盘 / 圆圈，只靠留白、
 * 字重与一颗租户主色按钮成立；图标缓慢呼吸提示可点，验证失败时变红并轻晃。
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
  const [breath] = useState(() => new Animated.Value(1));
  const [shake] = useState(() => new Animated.Value(0));

  // 图标呼吸：锁定且未失败时 0.45 ↔ 1 循环；失败后停下，交给红色 + 轻晃表达
  useEffect(() => {
    if (!locked || failed) {
      breath.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 0.45,
          duration: 1400,
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 1,
          duration: 1400,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breath, failed, locked]);

  useEffect(() => {
    if (!failed) return;
    shake.setValue(0);
    Animated.sequence(
      [8, -8, 6, -6, 3, 0].map((toValue) =>
        Animated.timing(shake, {
          toValue,
          duration: 55,
          useNativeDriver: true,
        }),
      ),
    ).start();
  }, [failed, shake]);

  // 最近任务列表的缩略图里可能正好是助记词或收款地址（安全评审 N24）
  useEffect(() => {
    void enableAppSwitcherProtection();
  }, []);

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
        // 进后台立刻把密钥锁上（阶段 0c-2）：解封窗口是"用户在场"的凭据，
        // 人一离开就不再成立。界面锁不锁仍按自动锁定时长决定，这里只管密钥——
        // 短暂切走再回来时用户不用重新解锁界面，但内存里的密钥已经清掉了。
        lockKeys();
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
    const outcome = await authenticate("security.locked.subtitle");
    prompting.current = false;
    if (outcome === "success" || outcome === "unavailable") {
      useAppLock.getState().unlock();
      return;
    }
    if (outcome === "failed") useAppLock.getState().noteAttemptFailed();
  }, []);

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
        paddingTop={insets.top + 28}
        paddingBottom={insets.bottom + 24}
        paddingHorizontal="$6"
      >
        <Stack alignItems="center">
          <BrandMark size={40} uri={logoUri} />
        </Stack>
        <Stack flex={1} alignItems="center" justifyContent="center" gap="$5">
          <Animated.View
            style={{ opacity: breath, transform: [{ translateX: shake }] }}
          >
            <Stack
              padding="$4"
              onPress={() => void unlock()}
              accessibilityRole="button"
              accessibilityLabel={t("security.unlock")}
              pressStyle={{ opacity: 0.6, scale: 0.96 }}
              testID="app-lock-unlock"
            >
              <AppIcon
                name={KIND_ICON[kind]}
                size={76}
                colorToken={failed ? "danger" : "color"}
              />
            </Stack>
          </Animated.View>
          <Stack alignItems="center" gap="$2">
            <InlineText
              fontSize={26}
              fontWeight="800"
              letterSpacing={-0.4}
              textAlign="center"
            >
              {t("security.locked.title")}
            </InlineText>
            <Body
              fontSize={15}
              textAlign="center"
              color="$textMuted"
              maxWidth={280}
            >
              {t("security.locked.subtitle")}
            </Body>
          </Stack>
        </Stack>
        <Stack gap="$3">
          <PrimaryButton
            height={52}
            fontSize={16}
            onPress={() => void unlock()}
            icon={
              <AppIcon
                name={KIND_ICON[kind]}
                size={20}
                colorToken="onPrimary"
              />
            }
            testID="app-lock-unlock-button"
          >
            {t(`security.unlock.with.${kind}`)}
          </PrimaryButton>
          {/* 固定一行高度，失败文案出现时按钮不跳位 */}
          <Body
            fontSize={13}
            textAlign="center"
            color="$danger"
            minHeight={20}
            testID="app-lock-failed"
          >
            {failed ? t("security.unlock.failed") : ""}
          </Body>
        </Stack>
      </Page>
    </Modal>
  );
}
