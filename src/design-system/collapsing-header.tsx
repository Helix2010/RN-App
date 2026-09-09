import {
  createContext,
  type PropsWithChildren,
  type ReactNode,
  type RefObject,
  useContext,
  useRef,
} from "react";
import {
  type RefreshControlProps,
  RefreshControl,
  ScrollView as RNScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";
import { Button, XStack, YStack, useTheme } from "tamagui";
import { AppIcon, Content, Page } from "./components";

/** 折叠过渡的滚动距离：紧凑标题在阈值前 24px 内淡入上移 */
export const COLLAPSE_DISTANCE = 24;
/** 导航底部细线在阈值前 8px 内出现 */
const HAIRLINE_DISTANCE = 8;
/** 悬浮条（页签页）的高度，不含状态栏 */
export const FLOATING_BAR_HEIGHT = 48;
const NAV_ROW_HEIGHT = 52;

/**
 * 折叠进度 0 → 1：由滚动位置对阈值插值，不是状态切换；阈值没测出来（< 0）时永远 0。
 * 纯函数，供测试与 worklet 共用。
 */
export function headerProgress(
  scrollY: number,
  threshold: number,
  distance = COLLAPSE_DISTANCE,
): number {
  "worklet";
  if (threshold < 0 || distance <= 0) return 0;
  const raw = (scrollY - (threshold - distance)) / distance;
  return raw <= 0 ? 0 : raw >= 1 ? 1 : raw;
}

const AnchorContext = createContext<((y: number) => void) | null>(null);

/**
 * 折叠阈值标记：放在滚动内容里"身份区"的正下方（必须是内容容器的直接子元素，onLayout 的 y 才是相对内容顶部的）。
 * 它的位置滚过导航 / 悬浮条底边时，导航完成折叠。没放就永远不折叠。
 */
export function CollapseAnchor() {
  const report = useContext(AnchorContext);
  return (
    <View
      onLayout={(event) => report?.(event.nativeEvent.layout.y)}
      testID="collapse-anchor"
    />
  );
}

type ScrollProps = {
  refresh?: RefreshControlProps;
  keyboardShouldPersistTaps?: "always" | "never" | "handled";
  /** 页内手势（图表刻度）进行中暂停滚动 */
  scrollEnabled?: boolean;
  /** 页面需要程序滚动（选中列表项后回顶等）时拿到滚动视图 */
  scrollRef?: RefObject<RNScrollView | null>;
  /** 内容容器（`Content`）的内边距与间距 */
  contentProps?: {
    paddingTop?: number;
    paddingBottom?: number;
    gap?: "$1" | "$2" | "$3" | "$4";
  };
  testID?: string;
};

/**
 * 滚动折叠导航（设计 collapsing-header-2026-09-09）。
 *
 * - `mode="nav"`（默认）：顶部固定一行导航（返回 · 中间 · 右侧动作）。`hero` 放在滚动内容最上面并被测量，
 *   它的底边滚过导航底边时，导航中间从 `expanded` 交叉淡入成 `collapsed`，同时出现 1px 细线；滑回去自然恢复。
 * - `mode="floating"`：页签页没有导航行；`hero` 滚过之后一条悬浮条从顶部淡入（`collapsed` 的内容，如钉住的筛选 chip
 *   或"资产 · 总额"），之前不占位、不拦手势。
 * 点击折叠后的中间区域回到顶部。折叠内容对读屏隐藏（它只是滚走内容的复本）。
 */
export function CollapsingHeader({
  mode = "nav",
  onBack,
  backLabel,
  expanded,
  collapsed,
  actions,
  footer,
  children,
  refresh,
  keyboardShouldPersistTaps = "handled",
  scrollEnabled = true,
  scrollRef,
  contentProps,
  testID,
}: PropsWithChildren<
  ScrollProps & {
    mode?: "nav" | "floating";
    onBack?: () => void;
    backLabel?: string;
    /** 展开态导航中间（分类小字 / 大标题 / 符号 + 副标题）；floating 模式不用 */
    expanded?: ReactNode;
    /** 折叠态导航中间 / 悬浮条内容；为空则永不折叠 */
    collapsed?: ReactNode;
    /** 导航右侧动作，折叠前后位置不变 */
    actions?: ReactNode;
    /** 滚动区之外、页面之内的东西：底部固定操作栏、底部面板 */
    footer?: ReactNode;
  }
>) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const scrollY = useSharedValue(0);
  const threshold = useSharedValue(-1);
  // 页面给了 scrollRef 就直接用它，不改写外部的 ref
  const inner = useRef<RNScrollView | null>(null);
  const scrollView = scrollRef ?? inner;
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });
  const barOffset = mode === "floating" ? insets.top + FLOATING_BAR_HEIGHT : 0;
  // nav 模式：标记滚到内容顶（= 导航底边）；floating 模式：滚到悬浮条底边。
  // 普通函数而不是 useCallback：共享值不能作为 hook 的依赖被"修改"（react-hooks/immutability）
  const reportAnchor = (y: number) => {
    threshold.value = Math.max(1, y - barOffset);
  };
  const toTop = () => scrollView.current?.scrollTo({ y: 0, animated: true });

  const expandedStyle = useAnimatedStyle(() => ({
    opacity: 1 - headerProgress(scrollY.value, threshold.value),
  }));
  const collapsedStyle = useAnimatedStyle(() => {
    const p = headerProgress(scrollY.value, threshold.value);
    return {
      opacity: p,
      transform: [{ translateY: (1 - p) * 8 }],
      pointerEvents: p > 0.5 ? "auto" : "none",
    };
  });
  const hairlineStyle = useAnimatedStyle(() => ({
    opacity: headerProgress(scrollY.value, threshold.value, HAIRLINE_DISTANCE),
  }));

  const scroll = (
    <Animated.ScrollView
      ref={scrollView}
      onScroll={onScroll}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      scrollEnabled={scrollEnabled}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      style={{ flex: 1 }}
      refreshControl={
        refresh ? (
          <RefreshControl
            tintColor={theme.primary.val}
            colors={[theme.primary.val]}
            {...refresh}
          />
        ) : undefined
      }
      testID={testID}
    >
      <AnchorContext.Provider value={reportAnchor}>
        <Content
          paddingTop={contentProps?.paddingTop}
          paddingBottom={contentProps?.paddingBottom}
          gap={contentProps?.gap}
        >
          {children}
        </Content>
      </AnchorContext.Provider>
    </Animated.ScrollView>
  );

  if (mode === "floating")
    return (
      <Page>
        {scroll}
        {footer}
        {collapsed ? (
          <Animated.View
            style={[
              { position: "absolute", top: 0, left: 0, right: 0 },
              collapsedStyle,
            ]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            testID="collapsing-bar"
          >
            <YStack backgroundColor="$background" paddingTop={insets.top}>
              <Content paddingBottom={0} gap="$0">
                <XStack
                  alignItems="center"
                  height={FLOATING_BAR_HEIGHT}
                  gap="$2"
                >
                  {collapsed}
                </XStack>
              </Content>
              <YStack height={1} backgroundColor="$borderColor" />
            </YStack>
          </Animated.View>
        ) : null}
      </Page>
    );

  return (
    <Page>
      <YStack backgroundColor="$background" paddingTop={insets.top + 8}>
        <Content paddingBottom={0} gap="$0">
          <XStack alignItems="center" gap="$3" minHeight={NAV_ROW_HEIGHT}>
            {onBack ? (
              <Button
                width={44}
                height={44}
                padding={0}
                backgroundColor="transparent"
                color="$color"
                borderWidth={0}
                onPress={onBack}
                accessibilityRole="button"
                accessibilityLabel={backLabel}
                pressStyle={{
                  opacity: 0.72,
                  backgroundColor: "$surfaceVariant",
                }}
              >
                <AppIcon name="chevron-left" size={28} colorToken="color" />
              </Button>
            ) : null}
            <YStack flex={1} justifyContent="center" minHeight={44}>
              <Animated.View style={expandedStyle}>{expanded}</Animated.View>
              {collapsed ? (
                <Animated.View
                  style={[
                    {
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: 0,
                      bottom: 0,
                      justifyContent: "center",
                    },
                    collapsedStyle,
                  ]}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  testID="collapsing-compact"
                >
                  <XStack
                    alignItems="center"
                    gap="$2"
                    onPress={toTop}
                    pressStyle={{ opacity: 0.75 }}
                  >
                    {collapsed}
                  </XStack>
                </Animated.View>
              ) : null}
            </YStack>
            {actions}
          </XStack>
        </Content>
        <Animated.View style={hairlineStyle}>
          <YStack height={1} backgroundColor="$borderColor" />
        </Animated.View>
      </YStack>
      {scroll}
      {footer}
    </Page>
  );
}
