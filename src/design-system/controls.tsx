import { useEffect, type ReactNode } from "react";
import { Pressable, TextInput, type TextInputProps } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Text, XStack, YStack, useTheme } from "tamagui";
import { AppIcon, type AppIconName } from "./components";

/** 开关：44×26，150ms 滑动，thumb 白色；只读时降低透明度。 */
export function Switch({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
  testID,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
  testID?: string;
}) {
  const theme = useTheme();
  const progress = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(value ? 1 : 0, { duration: 150 });
  }, [progress, value]);
  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: 3 + progress.value * 18 }],
  }));
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      hitSlop={8}
      style={{
        width: 44,
        height: 26,
        borderRadius: 13,
        backgroundColor: value ? theme.primary.val : theme.borderColor.val,
        opacity: disabled ? 0.5 : 1,
        justifyContent: "center",
      }}
    >
      <Animated.View
        style={[
          {
            width: 20,
            height: 20,
            borderRadius: 10,
            backgroundColor: "#FFFFFF",
            elevation: 2,
          },
          thumb,
        ]}
      />
    </Pressable>
  );
}

/** 单选行：右侧圆点，整行可点。 */
export function RadioRow({
  label,
  description,
  selected,
  onPress,
  icon,
  trailing,
  testID,
}: {
  label: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  icon?: AppIconName;
  trailing?: ReactNode;
  testID?: string;
}) {
  return (
    <XStack
      alignItems="center"
      gap="$3"
      paddingVertical="$3"
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      testID={testID}
      pressStyle={{ opacity: 0.7 }}
    >
      {icon ? (
        <AppIcon
          name={icon}
          size={22}
          colorToken={selected ? "primary" : "textMuted"}
        />
      ) : null}
      <YStack flex={1} gap="$0.5">
        <Text fontSize={15} fontWeight="600" color="$color">
          {label}
        </Text>
        {description ? (
          <Text fontSize={12} color="$textMuted">
            {description}
          </Text>
        ) : null}
      </YStack>
      {trailing}
      <YStack
        width={22}
        height={22}
        borderRadius={11}
        borderWidth={2}
        borderColor={selected ? "$primary" : "$borderColor"}
        alignItems="center"
        justifyContent="center"
      >
        {selected ? (
          <YStack
            width={12}
            height={12}
            borderRadius={6}
            backgroundColor="$primary"
          />
        ) : null}
      </YStack>
    </XStack>
  );
}

/** 下划线 Tabs（币安式）：选中项加粗 + 2px 主色下划线。 */
export function Tabs<T extends string>({
  value,
  options,
  onChange,
  accessibilityLabel,
  scrollable,
}: {
  value: T;
  options: { value: T; label: string; badge?: number }[];
  onChange: (value: T) => void;
  accessibilityLabel: string;
  scrollable?: boolean;
}) {
  return (
    <XStack
      gap={scrollable ? "$4" : 0}
      borderBottomWidth={1}
      borderColor="$borderColor"
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <YStack
            key={option.value}
            flex={scrollable ? undefined : 1}
            alignItems="center"
            paddingVertical="$2.5"
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            pressStyle={{ opacity: 0.7 }}
          >
            <XStack alignItems="center" gap="$1.5">
              <Text
                fontSize={14}
                fontWeight={selected ? "800" : "600"}
                color={selected ? "$color" : "$textMuted"}
              >
                {option.label}
              </Text>
              {option.badge ? (
                <XStack
                  borderRadius={999}
                  paddingHorizontal={6}
                  minWidth={18}
                  height={18}
                  alignItems="center"
                  justifyContent="center"
                  backgroundColor="$primary"
                >
                  <Text fontSize={10} fontWeight="800" color="$onPrimary">
                    {option.badge}
                  </Text>
                </XStack>
              ) : null}
            </XStack>
            <YStack
              position="absolute"
              bottom={-1}
              left={scrollable ? 0 : "30%"}
              right={scrollable ? 0 : "30%"}
              height={2}
              borderRadius={1}
              backgroundColor={selected ? "$primary" : "transparent"}
            />
          </YStack>
        );
      })}
    </XStack>
  );
}

/** 文本输入框：surfaceVariant 底，聚焦主色描边；支持左右插槽。 */
export function TextField({
  value,
  onChangeText,
  placeholder,
  leading,
  trailing,
  error,
  accessibilityLabel,
  testID,
  ...rest
}: Omit<TextInputProps, "style"> & {
  leading?: ReactNode;
  trailing?: ReactNode;
  error?: string;
  accessibilityLabel: string;
}) {
  const theme = useTheme();
  return (
    <YStack gap="$1">
      <XStack
        alignItems="center"
        gap="$2"
        height={48}
        paddingHorizontal="$3"
        borderRadius="$4"
        backgroundColor="$surfaceVariant"
        borderWidth={1}
        borderColor={error ? "$danger" : "$borderColor"}
        focusStyle={{ borderColor: "$primary" }}
      >
        {leading}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.textMuted.val}
          accessibilityLabel={accessibilityLabel}
          testID={testID}
          style={{
            flex: 1,
            color: theme.color.val,
            fontSize: 15,
            paddingVertical: 0,
          }}
          {...rest}
        />
        {trailing}
      </XStack>
      {error ? (
        <Text fontSize={12} color="$danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </YStack>
  );
}

/** 金额输入：大号等宽数字 + 币种后缀 + 快捷比例；只允许数字与一个小数点。 */
export function AmountInput({
  value,
  onChangeText,
  symbol,
  decimals = 6,
  helper,
  error,
  onMax,
  maxLabel,
  presets,
  onPreset,
  accessibilityLabel,
  testID,
  autoFocus,
}: {
  value: string;
  onChangeText: (next: string) => void;
  symbol: string;
  decimals?: number;
  helper?: string;
  error?: string;
  onMax?: () => void;
  maxLabel?: string;
  presets?: number[];
  onPreset?: (pct: number) => void;
  accessibilityLabel: string;
  testID?: string;
  autoFocus?: boolean;
}) {
  const theme = useTheme();
  const sanitize = (text: string) => {
    let next = text.replace(/[^\d.]/g, "");
    const dot = next.indexOf(".");
    if (dot >= 0)
      next = `${next.slice(0, dot + 1)}${next
        .slice(dot + 1)
        .replace(/\./g, "")
        .slice(0, decimals)}`;
    if (next.startsWith(".")) next = `0${next}`;
    onChangeText(next);
  };
  return (
    <YStack gap="$2">
      <XStack
        alignItems="center"
        gap="$2"
        borderBottomWidth={1}
        borderColor={error ? "$danger" : "$borderColor"}
        paddingBottom="$2"
      >
        <TextInput
          value={value}
          onChangeText={sanitize}
          keyboardType="decimal-pad"
          inputMode="decimal"
          placeholder="0"
          autoFocus={autoFocus}
          placeholderTextColor={theme.textMuted.val}
          accessibilityLabel={accessibilityLabel}
          testID={testID}
          style={{
            flex: 1,
            fontSize: 32,
            fontWeight: "800",
            color: theme.color.val,
            fontVariant: ["tabular-nums"],
            paddingVertical: 0,
          }}
        />
        <Text fontSize={16} fontWeight="700" color="$textMuted">
          {symbol}
        </Text>
        {onMax && maxLabel ? (
          <Pressable
            onPress={onMax}
            accessibilityRole="button"
            accessibilityLabel={maxLabel}
            hitSlop={6}
          >
            <XStack
              borderRadius={999}
              paddingHorizontal="$2.5"
              paddingVertical="$1"
              backgroundColor="$surfaceVariant"
            >
              <Text fontSize={12} fontWeight="800" color="$primary">
                {maxLabel}
              </Text>
            </XStack>
          </Pressable>
        ) : null}
      </XStack>
      {helper || error ? (
        <Text
          fontSize={12}
          color={error ? "$danger" : "$textMuted"}
          accessibilityLiveRegion="polite"
        >
          {error ?? helper}
        </Text>
      ) : null}
      {presets && onPreset ? (
        <XStack gap="$2">
          {presets.map((pct) => (
            <XStack
              key={pct}
              flex={1}
              justifyContent="center"
              paddingVertical="$1.5"
              borderRadius="$3"
              backgroundColor="$surfaceVariant"
              onPress={() => onPreset(pct)}
              accessibilityRole="button"
              accessibilityLabel={`${pct}%`}
              pressStyle={{ opacity: 0.7 }}
            >
              <Text fontSize={12} fontWeight="700" color="$color">
                {pct}%
              </Text>
            </XStack>
          ))}
        </XStack>
      ) : null}
    </YStack>
  );
}

/** 键值明细行（确认层复述关键数字）。 */
export function DetailRow({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: ReactNode;
  tone?: "positive" | "negative" | "warning" | "muted";
  hint?: string;
}) {
  const color =
    tone === "positive"
      ? "$pricePositive"
      : tone === "negative"
        ? "$priceNegative"
        : tone === "warning"
          ? "$warning"
          : tone === "muted"
            ? "$textMuted"
            : "$color";
  return (
    <XStack
      justifyContent="space-between"
      alignItems="center"
      paddingVertical="$1.5"
      gap="$3"
    >
      <XStack alignItems="center" gap="$1" flexShrink={1}>
        <Text fontSize={13} color="$textMuted">
          {label}
        </Text>
        {hint ? (
          <AppIcon
            name="information-outline"
            size={14}
            colorToken="textMuted"
          />
        ) : null}
      </XStack>
      {typeof value === "string" || typeof value === "number" ? (
        <Text
          fontSize={13}
          fontWeight="700"
          color={color}
          fontVariant={["tabular-nums"]}
          textAlign="right"
        >
          {value}
        </Text>
      ) : (
        value
      )}
    </XStack>
  );
}
