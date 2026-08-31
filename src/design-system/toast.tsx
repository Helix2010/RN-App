import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { FadeInUp, FadeOutUp } from "react-native-reanimated";
import { Text, XStack, YStack } from "tamagui";
import { create } from "zustand";
import { AppIcon, type AppIconName } from "./components";

export type ToastKind = "success" | "error" | "info" | "warning";
type Toast = { id: number; kind: ToastKind; text: string; durationMs: number };

type ToastState = {
  queue: Toast[];
  show: (text: string, kind?: ToastKind, durationMs?: number) => void;
  dismiss: (id: number) => void;
};

let nextToastId = 1;

const useToastStore = create<ToastState>((set) => ({
  queue: [],
  show: (text, kind = "info", durationMs = 2_400) =>
    set((state) => ({
      queue: [
        ...state.queue.slice(-2),
        { id: nextToastId++, kind, text, durationMs },
      ],
    })),
  dismiss: (id) =>
    set((state) => ({ queue: state.queue.filter((item) => item.id !== id) })),
}));

/** 任意位置调用：toast("已复制", "success") */
export function toast(
  text: string,
  kind: ToastKind = "info",
  durationMs?: number,
): void {
  if (kind === "success")
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  else if (kind === "error")
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  useToastStore.getState().show(text, kind, durationMs);
}

const ICONS: Record<ToastKind, AppIconName> = {
  success: "check-circle",
  error: "alert-circle",
  info: "information",
  warning: "alert",
};

/** 挂在根组件：顶部下滑出现，自动消失，可点按关闭。 */
export function ToastHost() {
  const queue = useToastStore((state) => state.queue);
  const insets = useSafeAreaInsets();
  return (
    <YStack
      position="absolute"
      top={insets.top + 8}
      left={0}
      right={0}
      alignItems="center"
      gap="$2"
      pointerEvents="box-none"
    >
      {queue.map((item) => (
        <ToastItem key={item.id} toast={item} />
      ))}
    </YStack>
  );
}

function ToastItem({ toast: item }: { toast: Toast }) {
  const dismiss = useToastStore((state) => state.dismiss);
  useEffect(() => {
    const timer = setTimeout(() => dismiss(item.id), item.durationMs);
    return () => clearTimeout(timer);
  }, [dismiss, item.durationMs, item.id]);
  const colorToken =
    item.kind === "success"
      ? "success"
      : item.kind === "error"
        ? "danger"
        : item.kind === "warning"
          ? "warning"
          : "info";
  return (
    <Animated.View
      entering={FadeInUp.duration(220)}
      exiting={FadeOutUp.duration(180)}
    >
      <XStack
        alignItems="center"
        gap="$2"
        paddingHorizontal="$3.5"
        paddingVertical="$2.5"
        borderRadius={999}
        backgroundColor="$surface"
        borderWidth={1}
        borderColor="$borderColor"
        shadowColor="#000"
        shadowOpacity={0.18}
        shadowRadius={12}
        elevation={6}
        maxWidth="90%"
        onPress={() => dismiss(item.id)}
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
      >
        <AppIcon name={ICONS[item.kind]} size={18} colorToken={colorToken} />
        <Text
          fontSize={14}
          fontWeight="600"
          color="$color"
          numberOfLines={2}
          flexShrink={1}
        >
          {item.text}
        </Text>
      </XStack>
    </Animated.View>
  );
}
