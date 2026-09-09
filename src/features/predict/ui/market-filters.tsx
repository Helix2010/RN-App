import {
  AppIcon,
  Body,
  InlineText,
  Row,
  Stack,
  TextLink,
} from "../../../design-system";

/**
 * 一级分类 chip：选中反白（`$color` 底 / `$background` 字），未选 `$surfaceVariant` 底。
 * 颜色全部走主题 token，租户换主色时跟着变。
 */
export function TagChip({
  label,
  selected,
  muted = false,
  disabled = false,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  /** "更多 ▾"这类动作 chip：字用弱色 */
  muted?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Stack
      paddingHorizontal="$3"
      paddingVertical="$1.5"
      borderRadius={999}
      backgroundColor={selected ? "$color" : "$surfaceVariant"}
      opacity={disabled ? 0.4 : 1}
      onPress={disabled ? undefined : onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      pressStyle={{ opacity: 0.75 }}
      testID={testID}
    >
      <InlineText
        fontSize={13}
        fontWeight="700"
        color={selected ? "$background" : muted ? "$textMuted" : "$color"}
      >
        {label}
      </InlineText>
    </Stack>
  );
}

/** 二级分类 chip：比一级弱一档——描边、无底色；选中加粗深描边，不反白，避免与一级抢层级 */
export function SubTagChip({
  label,
  selected,
  disabled = false,
  onPress,
  testID,
}: {
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Stack
      height={30}
      justifyContent="center"
      paddingHorizontal="$2.5"
      borderRadius={999}
      borderWidth={selected ? 1.5 : 1}
      borderColor={selected ? "$color" : "$borderColor"}
      opacity={disabled ? 0.4 : 1}
      onPress={disabled ? undefined : onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      pressStyle={{ opacity: 0.75 }}
      testID={testID}
    >
      <InlineText
        fontSize={12}
        fontWeight={selected ? "700" : "600"}
        color={selected ? "$color" : "$textMuted"}
      >
        {label}
      </InlineText>
    </Stack>
  );
}

/** 分类下没有事件：一张空态卡 + 两个出路，不留白屏 */
export function EmptyTagCard({
  title,
  hint,
  actions,
  testID,
}: {
  title: string;
  hint: string;
  actions: { label: string; onPress: () => void; testID?: string }[];
  testID?: string;
}) {
  return (
    <Stack
      alignItems="center"
      gap="$2"
      padding="$4"
      borderRadius="$4"
      borderWidth={1}
      borderColor="$borderColor"
      backgroundColor="$surface"
      testID={testID}
    >
      <AppIcon
        name="text-box-search-outline"
        size={24}
        colorToken="textMuted"
      />
      <InlineText fontSize={13} fontWeight="700" textAlign="center">
        {title}
      </InlineText>
      <Body fontSize={12} textAlign="center">
        {hint}
      </Body>
      <Row gap="$4" justifyContent="center">
        {actions.map((action) => (
          <TextLink
            key={action.label}
            onPress={action.onPress}
            color="$color"
            testID={action.testID}
          >
            {action.label}
          </TextLink>
        ))}
      </Row>
    </Stack>
  );
}

/** 搜索态里的小节标题（标签 / 市场），右侧可带数量 */
export function SearchSectionTitle({
  title,
  trailing,
}: {
  title: string;
  trailing?: string;
}) {
  return (
    <Row justifyContent="space-between" alignItems="baseline">
      <InlineText
        fontSize={11}
        fontWeight="700"
        color="$textMuted"
        letterSpacing={1}
      >
        {title}
      </InlineText>
      {trailing ? (
        <InlineText fontSize={11} color="$textMuted">
          {trailing}
        </InlineText>
      ) : null}
    </Row>
  );
}
