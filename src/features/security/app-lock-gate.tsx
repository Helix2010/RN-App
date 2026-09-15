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
  Stack,
  useTheme,
  useThemeName,
  type AppIconName,
} from "../../design-system";
import { useGateways } from "../../core/gateways/gateway-context";
import { useSession } from "../session/hooks/use-session";

/** 图标的点按区域，同时也是光环的直径：拇指够得着，光环扩到边缘刚好不出血 */
const TAP_SIZE = 152;
/**
 * 涟漪最亮时的透明度。暗色底下细描边更容易被底色吃掉，给它多一点。
 */
const HALO_OPACITY = { light: 0.62, dark: 0.68 } as const;
/** 一圈涟漪走完的时长；两圈错开半个周期，看上去是连续往外扩 */
const RIPPLE_MS = 2000;
/**
 * 两次系统弹窗之间至少留出的间隔。Android 的 BiometricPrompt 一次只认一个请求：
 * 上一个还在收起时再拉起，系统直接回一个取消，界面上什么都不出现。
 */
const PROMPT_SETTLE_MS = 350;
/** 这么快回来的"取消"不可能是人点的，是系统挡掉了这次请求 */
const SYSTEM_CANCEL_MS = 500;

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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
 * 锁屏进入锁定态自动弹一次系统验证；用户取消后轻触图标重试——图标本身就是那个
 * 按钮，底部不再放一颗同样动作的主按钮。解锁区放在屏幕下三分之一，单手握持时
 * 拇指够得到，横向仍然居中。页面刻意克制：图标不加任何底盘 / 圆圈，只靠留白与
 * 字重成立；图标缓慢呼吸提示可点，验证失败时变红并轻晃。
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
  /** 上一次系统弹窗结束的时刻，用来给下一次留出收起时间 */
  const lastPromptEndedAt = useRef(0);
  const [breath] = useState(() => new Animated.Value(0));
  const [halo] = useState(() => new Animated.Value(0));
  const [halo2] = useState(() => new Animated.Value(0));
  const [shake] = useState(() => new Animated.Value(0));
  const theme = useTheme();
  const themeName = useThemeName();
  const haloOpacity = String(themeName).includes("dark")
    ? HALO_OPACITY.dark
    : HALO_OPACITY.light;

  /*
   * 提示"这里可以点"：图标本身缩放 + 淡入淡出，外加一圈主色涟漪从图标扩散出去。
   * 只淡图标的透明度太不明显——图标本来就是单色，淡一点像是渲染没画完。
   * 涟漪用描边不用实心圆：实心的那一版静止时像给图标加了个底盘（设计上不要底盘），
   * 暗色下还发闷；描边扩散出去再消失，是动的形状，余光里就能看到。
   * 失败后两个都停下，交给红色 + 轻晃表达。
   */
  useEffect(() => {
    if (!locked || failed) {
      breath.setValue(0);
      halo.setValue(0);
      halo2.setValue(0);
      return undefined;
    }
    const ripple = (value: Animated.Value) =>
      Animated.loop(
        Animated.timing(value, {
          toValue: 1,
          duration: RIPPLE_MS,
          useNativeDriver: true,
        }),
      );
    const loops = [
      Animated.loop(
        Animated.sequence([
          Animated.timing(breath, {
            toValue: 1,
            duration: RIPPLE_MS / 2,
            useNativeDriver: true,
          }),
          Animated.timing(breath, {
            toValue: 0,
            duration: RIPPLE_MS / 2,
            useNativeDriver: true,
          }),
        ]),
      ),
      ripple(halo),
    ];
    loops[0]?.start();
    loops[1]?.start();
    // 第二圈晚半个周期出发，两圈交替，任何一帧上都有一圈正在扩散
    const second = setTimeout(() => {
      const delayed = ripple(halo2);
      loops.push(delayed);
      delayed.start();
    }, RIPPLE_MS / 2);
    return () => {
      clearTimeout(second);
      for (const loop of loops) loop.stop();
    };
  }, [breath, failed, halo, halo2, locked]);

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

  /**
   * 拉起系统验证。三件事都是为了"点了没反应"这个现象：
   * 1. 两次弹窗之间留出收起时间；
   * 2. 秒回的取消当作系统挡掉（不是人点的），自动重试一次；
   * 3. 重入标记在 finally 里清——卡住之后这一页就再也弹不出来了。
   */
  const unlock = useCallback(async () => {
    if (prompting.current) return;
    prompting.current = true;
    try {
      const settle =
        PROMPT_SETTLE_MS - (Date.now() - lastPromptEndedAt.current);
      if (settle > 0) await wait(settle);
      const startedAt = Date.now();
      let outcome = await authenticate("security.locked.subtitle");
      if (
        outcome === "cancelled" &&
        Date.now() - startedAt < SYSTEM_CANCEL_MS
      ) {
        await wait(PROMPT_SETTLE_MS);
        outcome = await authenticate("security.locked.subtitle");
      }
      if (outcome === "success" || outcome === "unavailable") {
        useAppLock.getState().unlock();
        return;
      }
      if (outcome === "failed") useAppLock.getState().noteAttemptFailed();
    } finally {
      lastPromptEndedAt.current = Date.now();
      prompting.current = false;
    }
  }, []);

  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      const store = useAppLock.getState();
      if (next === "background" || next === "inactive") {
        /*
         * 息屏 / 切走时系统会把 BiometricPrompt 一起收掉，而 expo 那个 Promise
         * 可能永远不 resolve（用户按电源键锁屏时踩到过）。防重入标记等它返回才清，
         * 于是永远停在"正在弹"，之后每次点图标都被自己挡掉——表现就是再也弹不出来。
         * 弹窗这时已经没了，直接把标记放开，回前台再补弹一次。
         */
        prompting.current = false;
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
        return;
      }
      store.clearBackgrounded();
      // 回前台时锁还在（上一次弹窗被切走打断，或用户取消后切走）：再弹一次。
      // 不补这一下，用户回来只看到一个图标，得自己去点
      if (store.locked) void unlock();
    };
    const subscription = AppState.addEventListener("change", onChange);
    return () => subscription.remove();
  }, [autoLockMinutes, lockKeys, signedIn, unlock]);

  // 一进入锁定态就自动弹一次系统验证，用户取消后可轻触图标重试
  useEffect(() => {
    if (locked) void unlock();
  }, [locked, unlock]);

  if (!locked) return null;

  /*
   * 覆盖层而不是独立窗口。`transparent={false}` 在 Android 上会新建一个 Dialog +
   * Window，窗口尺寸要等系统派发 WindowInsets 才能定；带了 statusBarTranslucent
   * 却没带 navigationBarTranslucent 时，首次测量会把导航栏那条高度扣掉，insets
   * 到达后再重新测一次铺满——表现就是"高度不够，闪一下又合适了"。
   * 冷启动时 insets 最不稳定，而这个页面恰好是冷启动第一个出现的全屏 Modal。
   * `Page` 自带 `$background` 且 flex:1，透明覆盖层在视觉上仍是不透明满屏。
   */
  return (
    <Modal
      visible
      animationType="fade"
      transparent
      presentationStyle="overFullScreen"
      statusBarTranslucent
      navigationBarTranslucent
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
        <Stack flex={1} alignItems="center" justifyContent="center" gap="$2">
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
        {/* 解锁区：落在屏幕下三分之一（拇指区），横向居中 */}
        <Stack alignItems="center" gap="$2" paddingBottom="$6">
          <Stack
            width={TAP_SIZE}
            height={TAP_SIZE}
            alignItems="center"
            justifyContent="center"
            onPress={() => void unlock()}
            accessibilityRole="button"
            accessibilityLabel={t("security.unlock")}
            pressStyle={{ opacity: 0.6, scale: 0.96 }}
            testID="app-lock-unlock"
          >
            {failed
              ? null
              : [halo, halo2].map((value, index) => (
                  <Animated.View
                    key={index}
                    pointerEvents="none"
                    style={{
                      position: "absolute",
                      width: TAP_SIZE,
                      height: TAP_SIZE,
                      borderRadius: TAP_SIZE / 2,
                      borderWidth: 3,
                      borderColor: theme.primary.val,
                      opacity: value.interpolate({
                        inputRange: [0, 0.08, 0.55, 1],
                        outputRange: [0, haloOpacity, haloOpacity * 0.5, 0],
                      }),
                      transform: [
                        {
                          scale: value.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.5, 1.22],
                          }),
                        },
                      ],
                    }}
                    testID={index === 0 ? "app-lock-halo" : undefined}
                  />
                ))}
            <Animated.View
              style={{
                opacity: breath.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 0.62],
                }),
                transform: [
                  {
                    scale: breath.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.12],
                    }),
                  },
                  { translateX: shake },
                ],
              }}
            >
              <AppIcon
                name={KIND_ICON[kind]}
                size={76}
                colorToken={failed ? "danger" : "color"}
              />
            </Animated.View>
          </Stack>
          {/* 图标没有文字标签，取消系统验证后要有一句话说明它可以点 */}
          <Body fontSize={14} textAlign="center" color="$textMuted">
            {t(`security.unlock.with.${kind}`)}
          </Body>
          {/* 固定一行高度，失败文案出现时上面的内容不跳位 */}
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
