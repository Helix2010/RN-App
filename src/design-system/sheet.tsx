import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { BackHandler } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, XStack, YStack, useTheme } from "tamagui";
import { IconButton } from "./components";

export type SheetHandle = { present: () => void; dismiss: () => void };

/**
 * 半屏面板：拖拽手柄下拉关闭、点遮罩关闭、右上 ×；`locked` 时三者全部禁用（签名进行中 / 强制流程）。
 * 高度自适应内容（enableDynamicSizing），超出屏幕时内部滚动。
 */
export const Sheet = forwardRef<
  SheetHandle,
  PropsWithChildren<{
    title?: string;
    subtitle?: string;
    locked?: boolean;
    scroll?: boolean;
    closeLabel: string;
    onDismiss?: () => void;
    footer?: ReactNode;
    testID?: string;
  }>
>(function Sheet(
  {
    title,
    subtitle,
    locked = false,
    scroll = false,
    closeLabel,
    onDismiss,
    footer,
    children,
    testID,
  },
  ref,
) {
  const modal = useRef<BottomSheetModal>(null);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [isOpen, setIsOpen] = useState(false);

  // Android 返回键：sheet 打开时先关 sheet；锁定时吞掉返回
  useEffect(() => {
    if (!isOpen) return undefined;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (!locked) modal.current?.dismiss();
        return true;
      },
    );
    return () => subscription.remove();
  }, [isOpen, locked]);

  useImperativeHandle(ref, () => ({
    present: () => modal.current?.present(),
    dismiss: () => modal.current?.dismiss(),
  }));

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={1}
        pressBehavior={locked ? "none" : "close"}
        style={[props.style, { backgroundColor: theme.backdrop.val }]}
      />
    ),
    [locked, theme.backdrop.val],
  );

  const Body = scroll ? BottomSheetScrollView : BottomSheetView;

  return (
    <BottomSheetModal
      ref={modal}
      enableDynamicSizing
      enablePanDownToClose={!locked}
      enableDismissOnClose
      backdropComponent={renderBackdrop}
      onDismiss={() => {
        setIsOpen(false);
        onDismiss?.();
      }}
      onChange={(index) => setIsOpen(index >= 0)}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      handleIndicatorStyle={{
        backgroundColor: theme.borderColor.val,
        width: 40,
      }}
      backgroundStyle={{
        backgroundColor: theme.surface.val,
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
      }}
      accessibilityViewIsModal
    >
      <Body style={{ paddingBottom: insets.bottom + 16 }} testID={testID}>
        {title || !locked ? (
          <XStack
            alignItems="center"
            paddingHorizontal="$4"
            paddingBottom="$2"
            gap="$2"
          >
            <YStack flex={1} gap="$0.5">
              {title ? (
                <Text
                  fontSize={18}
                  fontWeight="800"
                  color="$color"
                  accessibilityRole="header"
                >
                  {title}
                </Text>
              ) : null}
              {subtitle ? (
                <Text fontSize={13} color="$textMuted">
                  {subtitle}
                </Text>
              ) : null}
            </YStack>
            {!locked ? (
              <IconButton
                label={closeLabel}
                icon="close"
                size={28}
                onPress={() => modal.current?.dismiss()}
              />
            ) : null}
          </XStack>
        ) : null}
        <YStack paddingHorizontal="$4" gap="$3">
          {children}
        </YStack>
        {footer ? (
          <YStack paddingHorizontal="$4" paddingTop="$3">
            {footer}
          </YStack>
        ) : null}
      </Body>
    </BottomSheetModal>
  );
});
