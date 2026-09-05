import {
  Children,
  type ComponentProps,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  useState,
} from "react";
import type { RefreshControlProps } from "react-native";
import { Image, RefreshControl } from "react-native";
import {
  Button,
  ScrollView,
  Spinner,
  Text,
  XStack,
  YStack,
  styled,
  useTheme,
} from "tamagui";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useFonts } from "expo-font";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";

export const Page = styled(YStack, {
  flex: 1,
  backgroundColor: "$background",
});

export const Stack = styled(YStack, {});

export const Row = styled(XStack, {
  flexDirection: "row",
});

export const InlineText = styled(Text, {});

export type AppIconName = ComponentProps<typeof MaterialCommunityIcons>["name"];

export function AppIcon({
  name,
  size = 20,
  colorToken = "primary",
}: {
  name: AppIconName;
  size?: number;
  colorToken?:
    | "primary"
    | "onPrimary"
    | "color"
    | "textMuted"
    | "success"
    | "warning"
    | "danger"
    | "info";
}) {
  const theme = useTheme();
  const [fontLoaded] = useFonts(MaterialCommunityIcons.font);
  const colors = {
    primary: theme.primary.val,
    onPrimary: theme.onPrimary.val,
    color: theme.color.val,
    textMuted: theme.textMuted.val,
    success: theme.success.val,
    warning: theme.warning.val,
    danger: theme.danger.val,
    info: theme.info.val,
  };
  if (!fontLoaded) {
    return <YStack width={size} height={size} />;
  }
  return (
    <MaterialCommunityIcons
      name={name}
      size={size}
      color={colors[colorToken]}
    />
  );
}

/**
 * 租户 logo。`uri` 来自服务端品牌配置：没有配置就什么都不画——不存在"内置几何标"
 * 这种替身。图片下载完成前显示同尺寸骨架，占位但不冒充内容。
 */
export function BrandMark({ size = 48, uri }: { size?: number; uri?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  // 配置的图片下不下来：什么都不画（和没配一样），留一条 warning；不能留一个灰块
  if (!uri || failed) return null;
  return (
    <YStack width={size} height={size} testID="brand-mark">
      {loaded ? null : (
        <YStack position="absolute" inset={0}>
          <SkeletonBlock
            width={size}
            height={size}
            borderRadius={size * 0.28}
          />
        </YStack>
      )}
      <Image
        source={{ uri }}
        onLoad={() => setLoaded(true)}
        onError={() => {
          console.warn(`[brand] logo 加载失败：${uri}`);
          setFailed(true);
        }}
        style={{ width: size, height: size, borderRadius: size * 0.28 }}
        accessibilityLabel="brand logo"
      />
    </YStack>
  );
}

export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  onBack,
  backLabel,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
  action?: ReactNode;
}) {
  return (
    <XStack alignItems="center" gap="$3" paddingVertical="$2">
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
          pressStyle={{ opacity: 0.72, backgroundColor: "$surfaceVariant" }}
        >
          <AppIcon name="chevron-left" size={28} colorToken="color" />
        </Button>
      ) : null}
      <Stack flex={1} gap="$1">
        {eyebrow ? <Label>{eyebrow}</Label> : null}
        <Heading fontSize={26}>{title}</Heading>
        {subtitle ? <Body>{subtitle}</Body> : null}
      </Stack>
      {action}
    </XStack>
  );
}

export const Content = styled(YStack, {
  width: "100%",
  maxWidth: 720,
  alignSelf: "center",
  paddingHorizontal: "$4",
  paddingBottom: "$8",
  gap: "$4",
});

export const Card = styled(YStack, {
  backgroundColor: "$surface",
  borderColor: "$borderColor",
  borderWidth: 0,
  borderRadius: "$6",
  padding: "$4",
  gap: "$3",
  shadowColor: "$shadowColor",
  shadowOpacity: 0.1,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 10 },
});

export const SkeletonBlock = styled(YStack, {
  backgroundColor: "$surfaceVariant",
  borderRadius: "$4",
  opacity: 0.72,
});

export function IconButton({
  label,
  icon,
  onPress,
  backgroundColor = "$surfaceVariant",
  color = "$color",
  size = 42,
  testID,
}: {
  label: string;
  icon: AppIconName;
  onPress?: () => void;
  backgroundColor?: "$surfaceVariant" | "$onPrimary";
  color?: "$color" | "$primary";
  size?: number;
  testID?: string;
}) {
  return (
    <Button
      width={size}
      height={size}
      borderRadius={999}
      padding={0}
      backgroundColor={backgroundColor}
      color={color}
      borderWidth={0}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      pressStyle={{ opacity: 0.76, scale: 0.95 }}
    >
      <AppIcon
        name={icon}
        size={18}
        colorToken={color === "$primary" ? "primary" : "color"}
      />
    </Button>
  );
}

export function PageState({
  title,
  description,
  loading,
  action,
}: {
  title: string;
  description?: string;
  loading?: boolean;
  action?: ReactNode;
}) {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      padding="$6"
      gap="$3"
    >
      {loading ? <Spinner size="large" color="$primary" /> : null}
      <SectionTitle textAlign="center">{title}</SectionTitle>
      {description ? <Body textAlign="center">{description}</Body> : null}
      {action}
    </YStack>
  );
}

/** 不吸附的横向滚动（筛选 chip 行、代币行等）；需要吸附到卡片用 SnapCarousel。 */
export function HorizontalScroll({ children }: PropsWithChildren) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 12 }}
    >
      {children}
    </ScrollView>
  );
}

export function SnapCarousel({
  children,
  itemWidth = 236,
  gap = 12,
  fullWidth = false,
}: PropsWithChildren<{
  itemWidth?: number;
  gap?: number;
  fullWidth?: boolean;
}>) {
  const [viewportWidth, setViewportWidth] = useState(0);
  const resolvedItemWidth =
    fullWidth && viewportWidth > 0 ? viewportWidth : itemWidth;
  const scrollX = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollX.value = event.contentOffset.x;
    },
  });
  const items = Children.toArray(children);
  return (
    <Animated.ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      onScroll={onScroll}
      onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
      scrollEventThrottle={16}
      snapToInterval={resolvedItemWidth + gap}
      snapToAlignment="start"
      decelerationRate="fast"
      disableIntervalMomentum
      contentContainerStyle={{
        gap,
        paddingRight: fullWidth
          ? 0
          : Math.max(0, viewportWidth - resolvedItemWidth),
      }}
      accessibilityRole="adjustable"
      accessibilityHint="左右滑动浏览并自动吸附到卡片"
    >
      {items.map((child, index) => (
        <SnapCarouselItem
          key={(child as ReactElement).key ?? index}
          index={index}
          itemWidth={resolvedItemWidth}
          gap={gap}
          scrollX={scrollX}
        >
          {child}
        </SnapCarouselItem>
      ))}
    </Animated.ScrollView>
  );
}

function SnapCarouselItem({
  children,
  index,
  itemWidth,
  gap,
  scrollX,
}: PropsWithChildren<{
  index: number;
  itemWidth: number;
  gap: number;
  scrollX: { value: number };
}>) {
  const animatedStyle = useAnimatedStyle(() => {
    const center = index * (itemWidth + gap);
    const scale = interpolate(
      scrollX.value,
      [center - itemWidth - gap, center, center + itemWidth + gap],
      [0.92, 1, 0.92],
      Extrapolation.CLAMP,
    );
    return { transform: [{ scale }] };
  }, [gap, index, itemWidth]);
  return (
    <Animated.View style={[{ width: itemWidth }, animatedStyle]}>
      {children}
    </Animated.View>
  );
}

export const Heading = styled(Text, {
  color: "$color",
  fontSize: 28,
  lineHeight: 34,
  fontWeight: "800",
  letterSpacing: -0.7,
});

export const SectionTitle = styled(Text, {
  color: "$color",
  fontSize: 17,
  lineHeight: 22,
  fontWeight: "700",
});

export const Body = styled(Text, {
  color: "$textMuted",
  fontSize: 15,
  lineHeight: 22,
});

export const Label = styled(Text, {
  color: "$textMuted",
  fontSize: 12,
  lineHeight: 16,
  fontWeight: "700",
  letterSpacing: 0.7,
  textTransform: "uppercase",
});

export const AmountText = styled(Text, {
  color: "$color",
  fontSize: 25,
  lineHeight: 30,
  fontWeight: "700",
  fontVariant: ["tabular-nums"],
});

export const PrimaryButton = styled(Button, {
  height: 48,
  // Keep the visual button and its native hit target in sync when the parent
  // centers children (PageState, sheets, and other action stacks).
  alignSelf: "stretch",
  borderRadius: "$5",
  backgroundColor: "$primary",
  color: "$onPrimary",
  fontWeight: "700",
  pressStyle: { opacity: 0.86, scale: 0.99 },
  focusStyle: { outlineColor: "$focus", outlineWidth: 2 },
  disabledStyle: { opacity: 0.45 },
});

export const SecondaryButton = styled(Button, {
  height: 44,
  alignSelf: "stretch",
  borderRadius: "$5",
  backgroundColor: "$surfaceVariant",
  color: "$color",
  borderColor: "$borderColor",
  borderWidth: 1,
  fontWeight: "700",
  pressStyle: { opacity: 0.82 },
  disabledStyle: { opacity: 0.45 },
});

/**
 * 会自己表达"进行中"的按钮。
 *
 * Tamagui 的 Button 没有 `loading`，于是项目里每个异步按钮都在手写
 * `disabled={pending}` 加文案切换——漏掉就成了"点了没反应"。这里把它变成一个
 * prop：loading 时自动禁用、显示转圈、可选换文案。
 */
export function ActionButton({
  loading,
  loadingLabel,
  disabled,
  icon,
  children,
  ...rest
}: ComponentProps<typeof PrimaryButton> & {
  loading?: boolean;
  loadingLabel?: string;
}) {
  return (
    <PrimaryButton
      {...rest}
      disabled={disabled || loading}
      accessibilityState={{
        busy: Boolean(loading),
        disabled: Boolean(disabled || loading),
      }}
      icon={loading ? <Spinner size="small" color="$onPrimary" /> : icon}
    >
      {loading && loadingLabel ? loadingLabel : children}
    </PrimaryButton>
  );
}

export const Badge = styled(XStack, {
  alignSelf: "flex-start",
  alignItems: "center",
  borderRadius: 999,
  paddingHorizontal: "$2.5",
  paddingVertical: "$1.5",
  backgroundColor: "$surfaceVariant",
  borderColor: "$borderColor",
  borderWidth: 1,
});

export function PriceChange({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <Text
      color={positive ? "$pricePositive" : "$priceNegative"}
      fontWeight="700"
      fontVariant={["tabular-nums"]}
      accessibilityLabel={`${positive ? "上涨" : "下跌"} ${Math.abs(value)}%`}
    >
      {positive ? "+" : ""}
      {value.toFixed(2)}%
    </Text>
  );
}

type Segment<T extends string> = { value: T; label: string };

/**
 * 分段控件（2–4 个互斥选项：买/卖、转入/取回、周期）：一条浅色轨道，选中段浮起成白卡。
 * 不是一排平铺的药丸按钮——那种样式和"操作按钮"分不开，也没有"这是一组"的感觉。
 * 选项多于 4 个或不定长（链、分类、多结果市场）请用 `ChipRow`。
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  accessibilityLabel,
  size = "md",
  testID,
}: {
  value: T;
  options: Segment<T>[];
  onChange: (value: T) => void;
  accessibilityLabel: string;
  size?: "sm" | "md";
  testID?: string;
}) {
  const height = size === "sm" ? 30 : 36;
  return (
    <XStack
      padding={3}
      gap={2}
      borderRadius={size === "sm" ? 9 : 11}
      backgroundColor="$surfaceVariant"
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <XStack
            key={option.value}
            flex={1}
            height={height}
            alignItems="center"
            justifyContent="center"
            paddingHorizontal="$2"
            borderRadius={size === "sm" ? 7 : 9}
            backgroundColor={selected ? "$surface" : "transparent"}
            shadowColor="$shadowColor"
            shadowOpacity={selected ? 0.12 : 0}
            shadowRadius={4}
            shadowOffset={{ width: 0, height: 1 }}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            testID={testID ? `${testID}-${option.value}` : undefined}
            pressStyle={{ opacity: 0.7 }}
          >
            <Text
              fontSize={size === "sm" ? 12 : 13}
              fontWeight={selected ? "800" : "600"}
              color={selected ? "$color" : "$textMuted"}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </XStack>
        );
      })}
    </XStack>
  );
}

/**
 * 图标在上、文字在下的操作格（收款 / 转出 / 划转…）。一排 3–4 个等宽；
 * `primary` 的那一个是页面的主操作。文字只有一行，装不下的标签要改短。
 */
export function ActionTile({
  label,
  icon,
  primary,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  icon: AppIconName;
  primary?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <YStack
      flex={1}
      alignItems="center"
      justifyContent="center"
      gap="$1"
      height={60}
      borderRadius="$4"
      backgroundColor={primary ? "$primary" : "$surfaceVariant"}
      opacity={disabled ? 0.45 : 1}
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      testID={testID}
      pressStyle={{ opacity: 0.8 }}
    >
      <AppIcon
        name={icon}
        size={22}
        colorToken={primary ? "onPrimary" : "color"}
      />
      <Text
        fontSize={12}
        fontWeight="700"
        color={primary ? "$onPrimary" : "$color"}
        numberOfLines={1}
      >
        {label}
      </Text>
    </YStack>
  );
}

export function PageScroll({
  children,
  refresh,
  keyboardShouldPersistTaps = "handled",
  scrollEnabled = true,
}: PropsWithChildren<{
  refresh?: RefreshControlProps;
  keyboardShouldPersistTaps?: "always" | "never" | "handled";
  /** 页内手势（图表刻度）进行中暂停滚动 */
  scrollEnabled?: boolean;
}>) {
  const theme = useTheme();
  return (
    <ScrollView
      flex={1}
      showsVerticalScrollIndicator={false}
      scrollEnabled={scrollEnabled}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      refreshControl={
        refresh ? (
          <RefreshControl
            tintColor={theme.primary.val}
            colors={[theme.primary.val]}
            {...refresh}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  );
}
