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

/** 品牌标：优先使用租户服务端下发的 logo（uri），否则退回内置几何标。 */
export function BrandMark({ size = 48, uri }: { size?: number; uri?: string }) {
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width: size, height: size, borderRadius: size * 0.28 }}
        accessibilityLabel="brand logo"
      />
    );
  }
  return (
    <YStack
      width={size}
      height={size}
      alignItems="center"
      justifyContent="center"
      borderRadius={size * 0.28}
      backgroundColor="$primary"
      shadowColor="$shadowColor"
      shadowOpacity={0.2}
      shadowRadius={12}
      shadowOffset={{ width: 0, height: 6 }}
      accessibilityLabel="AnyFun 品牌标志"
    >
      <YStack
        position="absolute"
        left={size * 0.2}
        bottom={size * 0.16}
        width={size * 0.15}
        height={size * 0.62}
        borderRadius={999}
        backgroundColor="$onPrimary"
        opacity={0.9}
        rotate="-24deg"
      />
      <YStack
        position="absolute"
        right={size * 0.2}
        bottom={size * 0.16}
        width={size * 0.15}
        height={size * 0.62}
        borderRadius={999}
        backgroundColor="$onPrimary"
        opacity={0.72}
        rotate="24deg"
      />
      <YStack
        position="absolute"
        top={size * 0.31}
        width={size * 0.2}
        height={size * 0.2}
        rotate="45deg"
        borderRadius={size * 0.04}
        backgroundColor="$onPrimary"
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

export const HairlineCard = styled(Card, {
  borderWidth: 1,
  borderColor: "$borderColor",
  shadowOpacity: 0,
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

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  accessibilityLabel,
}: {
  value: T;
  options: Segment<T>[];
  onChange: (value: T) => void;
  accessibilityLabel: string;
}) {
  return (
    <XStack
      gap="$2"
      flexWrap="wrap"
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <Button
            key={option.value}
            size="$3.5"
            borderRadius={999}
            backgroundColor={selected ? "$primary" : "$surfaceVariant"}
            color={selected ? "$onPrimary" : "$color"}
            borderWidth={1}
            borderColor={selected ? "$primary" : "$borderColor"}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            pressStyle={{ opacity: 0.82 }}
          >
            {option.label}
          </Button>
        );
      })}
    </XStack>
  );
}

export function PageScroll({
  children,
  refresh,
  keyboardShouldPersistTaps = "handled",
}: PropsWithChildren<{
  refresh?: RefreshControlProps;
  keyboardShouldPersistTaps?: "always" | "never" | "handled";
}>) {
  const theme = useTheme();
  return (
    <ScrollView
      flex={1}
      showsVerticalScrollIndicator={false}
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
