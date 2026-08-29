import type { PropsWithChildren, ReactNode } from "react";
import type { RefreshControlProps } from "react-native";
import { RefreshControl } from "react-native";
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

export const Page = styled(YStack, {
  flex: 1,
  backgroundColor: "$background",
});

export const Stack = styled(YStack, {});

export const Row = styled(XStack, {
  flexDirection: "row",
});

export const InlineText = styled(Text, {});

export function BrandMark({ size = 48 }: { size?: number }) {
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

export function AppHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <XStack justifyContent="space-between" alignItems="center" gap="$3">
      <XStack alignItems="center" gap="$3" flex={1}>
        <BrandMark size={40} />
        <Stack gap="$1" flex={1}>
          {eyebrow ? <Label fontSize={11}>{eyebrow}</Label> : null}
          <Heading fontSize={24} lineHeight={29}>
            {title}
          </Heading>
          {subtitle ? (
            <Body fontSize={13} numberOfLines={1}>
              {subtitle}
            </Body>
          ) : null}
        </Stack>
      </XStack>
      {action}
    </XStack>
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
          width={42}
          height={42}
          borderRadius={999}
          padding={0}
          backgroundColor="$surfaceVariant"
          color="$color"
          borderColor="$borderColor"
          borderWidth={1}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={backLabel}
          pressStyle={{ opacity: 0.76, scale: 0.96 }}
        >
          <Text fontSize={28} lineHeight={30} marginTop={-2}>
            ‹
          </Text>
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

export const Divider = styled(YStack, {
  height: 1,
  width: "100%",
  backgroundColor: "$borderColor",
});

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

export function IconButton({
  label,
  symbol,
  onPress,
  backgroundColor = "$surfaceVariant",
  color = "$color",
}: {
  label: string;
  symbol: string;
  onPress?: () => void;
  backgroundColor?: "$surfaceVariant" | "$onPrimary";
  color?: "$color" | "$primary";
}) {
  return (
    <Button
      width={42}
      height={42}
      borderRadius={999}
      padding={0}
      backgroundColor={backgroundColor}
      color={color}
      borderWidth={0}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      pressStyle={{ opacity: 0.76, scale: 0.95 }}
    >
      <Text fontSize={18}>{symbol}</Text>
    </Button>
  );
}

export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
}: {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
}) {
  const content = (
    <XStack flex={1} alignItems="center" gap="$3">
      {leading}
      <Stack flex={1} gap="$1">
        <SectionTitle>{title}</SectionTitle>
        {subtitle ? <Body fontSize={12}>{subtitle}</Body> : null}
      </Stack>
      {trailing}
    </XStack>
  );
  return onPress ? (
    <Button
      minHeight={58}
      paddingHorizontal="$3"
      paddingVertical="$2"
      borderRadius="$4"
      backgroundColor="$surfaceVariant"
      borderWidth={0}
      onPress={onPress}
      pressStyle={{ opacity: 0.78 }}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      {content}
    </Button>
  ) : (
    <XStack minHeight={52} alignItems="center">
      {content}
    </XStack>
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

export const AddressText = styled(Text, {
  color: "$textMuted",
  fontSize: 13,
  lineHeight: 18,
  letterSpacing: 0.2,
});

export const PrimaryButton = styled(Button, {
  height: 48,
  borderRadius: "$5",
  backgroundColor: "$primary",
  color: "$onPrimary",
  fontWeight: "700",
  pressStyle: { opacity: 0.86, scale: 0.99 },
  focusStyle: { outlineColor: "$focus", outlineWidth: 2 },
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
});

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
}: PropsWithChildren<{ refresh?: RefreshControlProps }>) {
  const theme = useTheme();
  return (
    <ScrollView
      flex={1}
      showsVerticalScrollIndicator={false}
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
