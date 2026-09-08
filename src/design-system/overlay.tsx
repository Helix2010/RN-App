import {
  useEffect,
  useId,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { BackHandler, StyleSheet } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { Spinner, Text, YStack } from "tamagui";
import { create } from "zustand";
import { ToastHost } from "./toast";

/**
 * 应用级覆盖层：全屏遮罩 → 阻塞式 loading → toast，三层永远画在底部弹层之上。
 *
 * 为什么需要它：底部弹层（gorhom BottomSheetModal）由 BottomSheetModalProvider 在
 * 自己的 children **之后**渲染宿主，任何挂在 Provider 里面的 toast / loading 都被画到
 * 弹层下面——登录超时的提示曾被二维码弹层压住，只能靠"先关弹层再提示"绕开。
 * React Native 没有 createPortal，原生 Modal 又是独立窗口，根层提示根本进不去。
 *
 * 做法：`OverlayLayer` 挂在 BottomSheetModalProvider 之外、之后（App.tsx），
 * 任何位置通过 store 注册内容，都画在弹层之上：
 * - `FullScreenOverlay`：替代 RN `Modal` 的全屏遮罩（更新弹窗等），toast / loading 能盖住它；
 * - `useBlockingLoading` / `blockingLoading`：阻塞式进行中态，用于弹层关掉之后才结束的工作；
 * - `ToastHost`：最上层。
 *
 * 仍保留原生 Modal 的三处：应用锁（隐私上必须盖住一切，包括 toast）、OTA 强制更新
 * （阻塞态，不弹 toast）、扫码相机（不弹 toast）。
 *
 * 注意：`FullScreenOverlay` 的 children 在 `OverlayLayer` 所在位置渲染，拿到的 context
 * 是根层的（主题 / 运行时 / Query / 网关），没有导航与 BottomSheetModal 上下文；
 * 需要这些能力时通过 props 把回调传进来。
 */

type OverlayEntry = { id: string; node: ReactNode; testID?: string };
type LoadingState = { count: number; label: string | null };

type OverlayStore = {
  overlays: OverlayEntry[];
  loading: LoadingState;
  mount: (entry: OverlayEntry) => void;
  unmount: (id: string) => void;
  showLoading: (label?: string) => void;
  hideLoading: () => void;
};

const useOverlayStore = create<OverlayStore>((set) => ({
  overlays: [],
  loading: { count: 0, label: null },
  // 已存在的条目原地替换：children 每次渲染都是新元素，不能因此改变层叠顺序或重播入场动画
  mount: (entry) =>
    set((state) => {
      const index = state.overlays.findIndex((item) => item.id === entry.id);
      if (index < 0) return { overlays: [...state.overlays, entry] };
      const overlays = state.overlays.slice();
      overlays[index] = entry;
      return { overlays };
    }),
  unmount: (id) =>
    set((state) => ({
      overlays: state.overlays.filter((item) => item.id !== id),
    })),
  // 计数而不是布尔：两个并发的阻塞操作，先结束的那个不能把另一个的遮罩收掉
  showLoading: (label) =>
    set((state) => ({
      loading: {
        count: state.loading.count + 1,
        label: label ?? state.loading.label,
      },
    })),
  hideLoading: () =>
    set((state) => {
      const count = Math.max(0, state.loading.count - 1);
      return {
        loading: { count, label: count === 0 ? null : state.loading.label },
      };
    }),
}));

/**
 * 全屏遮罩，语义与 RN `Modal`（transparent, animationType="fade"）一致：
 * 可见时 Android 返回键被吞掉并回调 `onRequestClose`；内容铺满整个窗口，
 * 由调用方自己画遮罩背景与点击关闭。
 */
export function FullScreenOverlay({
  visible,
  onRequestClose,
  testID,
  children,
}: PropsWithChildren<{
  visible: boolean;
  onRequestClose?: () => void;
  testID?: string;
}>) {
  const id = useId();
  const mount = useOverlayStore((state) => state.mount);
  const unmount = useOverlayStore((state) => state.unmount);

  // 挂载 / 卸载只跟 visible 走；内容更新走下面那个 effect，避免每次渲染都先删再加
  useEffect(() => {
    if (!visible) return undefined;
    mount({ id, node: children, testID });
    return () => unmount(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mount, unmount, visible]);
  useEffect(() => {
    if (visible) mount({ id, node: children, testID });
  }, [children, id, mount, testID, visible]);

  useEffect(() => {
    if (!visible) return undefined;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        onRequestClose?.();
        return true;
      },
    );
    return () => subscription.remove();
  }, [onRequestClose, visible]);

  return null;
}

/** `active` 为真期间显示阻塞式 loading；卸载或转假时收起。 */
export function useBlockingLoading(active: boolean, label?: string): void {
  useEffect(() => {
    if (!active) return undefined;
    useOverlayStore.getState().showLoading(label);
    return () => useOverlayStore.getState().hideLoading();
  }, [active, label]);
}

/** 非组件代码里使用：`const done = blockingLoading.show("登录中…"); … done();` */
export const blockingLoading = {
  show(label?: string): () => void {
    useOverlayStore.getState().showLoading(label);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      useOverlayStore.getState().hideLoading();
    };
  },
};

function BlockingLoading({ label }: { label: string | null }) {
  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(120)}
      style={StyleSheet.absoluteFill}
      accessibilityViewIsModal
      testID="blocking-loading"
    >
      <YStack
        flex={1}
        alignItems="center"
        justifyContent="center"
        backgroundColor="$backdrop"
        accessibilityRole="progressbar"
        accessibilityLiveRegion="polite"
        accessibilityLabel={label ?? undefined}
      >
        <YStack
          alignItems="center"
          gap="$3"
          minWidth={140}
          paddingHorizontal="$5"
          paddingVertical="$4"
          borderRadius="$4"
          backgroundColor="$surface"
          borderWidth={1}
          borderColor="$borderColor"
        >
          <Spinner size="large" color="$primary" />
          {label ? (
            <Text
              fontSize={14}
              fontWeight="600"
              color="$color"
              textAlign="center"
            >
              {label}
            </Text>
          ) : null}
        </YStack>
      </YStack>
    </Animated.View>
  );
}

/**
 * 挂在根组件、`BottomSheetModalProvider` 之外且之后的兄弟位置。
 * 自身不拦截触摸（box-none），各层内容各自决定是否拦截。
 */
export function OverlayLayer() {
  const overlays = useOverlayStore((state) => state.overlays);
  const loading = useOverlayStore((state) => state.loading);
  return (
    <YStack
      position="absolute"
      inset={0}
      pointerEvents="box-none"
      testID="overlay-layer"
    >
      {overlays.map((entry) => (
        <Animated.View
          key={entry.id}
          entering={FadeIn.duration(180)}
          exiting={FadeOut.duration(150)}
          style={StyleSheet.absoluteFill}
          accessibilityViewIsModal
          testID={entry.testID}
        >
          {entry.node}
        </Animated.View>
      ))}
      {loading.count > 0 ? <BlockingLoading label={loading.label} /> : null}
      <ToastHost />
    </YStack>
  );
}
