import {
  forwardRef,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppIcon, Body, InlineText, Row, Stack, TextLink } from "./components";
import { TextField } from "./controls";
import { Sheet, type SheetHandle } from "./sheet";

/**
 * 筛选控件（设计 predict-home-filters-2026-09-09 §4.3 / §4.5）。
 *
 * 颜色一律走主题 token（`$primary` / `$color` / `$surfaceVariant` / `$borderColor` / `$textMuted`）：
 * 主色是租户品牌配置下发的，运行时会变，这里不能出现任何字面量颜色。
 */

export type FilterOption<T extends string> = { value: T; label: string };

/**
 * 下拉筛选 chip：显示当前值 + ▾，点开底部单选面板。
 * 当前值不是默认值时加一圈主色描边，提示"有筛选生效"。
 */
export function FilterSelect<T extends string>({
  label,
  value,
  defaultValue,
  options,
  onChange,
  closeLabel,
  testID,
}: {
  label: string;
  value: T;
  defaultValue: T;
  options: FilterOption<T>[];
  onChange: (value: T) => void;
  /** Sheet 右上角关闭按钮的无障碍文案（调用方传 t("common.close")） */
  closeLabel: string;
  testID?: string;
}) {
  const sheet = useRef<SheetHandle>(null);
  const current = options.find((option) => option.value === value);
  const currentLabel = current?.label ?? "";
  const dirty = value !== defaultValue;
  return (
    <>
      <Row
        alignItems="center"
        gap="$1"
        height={32}
        paddingHorizontal="$3"
        borderRadius={999}
        backgroundColor="$surfaceVariant"
        borderWidth={dirty ? 1.5 : 0}
        borderColor="$primary"
        onPress={() => sheet.current?.present()}
        pressStyle={{ opacity: 0.75 }}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${currentLabel}`}
        testID={testID}
      >
        <InlineText fontSize={12.5} fontWeight="700" color="$color">
          {currentLabel}
        </InlineText>
        <AppIcon name="chevron-down" size={14} colorToken="color" />
      </Row>
      <Sheet
        ref={sheet}
        title={label}
        closeLabel={closeLabel}
        scroll
        testID={testID ? `${testID}-sheet` : undefined}
      >
        <Stack>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <Row
                key={option.value}
                alignItems="center"
                justifyContent="space-between"
                gap="$2"
                height={48}
                paddingHorizontal="$1"
                borderBottomWidth={1}
                borderColor="$borderColor"
                onPress={() => {
                  onChange(option.value);
                  sheet.current?.dismiss();
                }}
                pressStyle={{ opacity: 0.75 }}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                testID={testID ? `${testID}-option-${option.value}` : undefined}
              >
                <InlineText
                  fontSize={13}
                  fontWeight={selected ? "700" : "500"}
                  color="$color"
                >
                  {option.label}
                </InlineText>
                {selected ? (
                  <AppIcon name="check" size={18} colorToken="primary" />
                ) : null}
              </Row>
            );
          })}
        </Stack>
      </Sheet>
    </>
  );
}

/** 列表顶部的"已筛选：… [清除]"提示行，只在筛选偏离默认值时渲染 */
export function FilterBanner({
  label,
  summary,
  clearLabel,
  onClear,
  testID,
}: {
  label: string;
  summary: string;
  clearLabel: string;
  onClear: () => void;
  testID?: string;
}) {
  return (
    <Row
      alignItems="center"
      justifyContent="space-between"
      gap="$2"
      minHeight={32}
      paddingHorizontal="$3"
      borderRadius={8}
      backgroundColor="$surfaceVariant"
      testID={testID}
    >
      <Body fontSize={11} color="$textMuted" flex={1} numberOfLines={1}>
        {label}：
        <InlineText fontSize={11} fontWeight="600" color="$color">
          {summary}
        </InlineText>
      </Body>
      <TextLink
        onPress={onClear}
        color="$color"
        fontSize={11}
        testID={testID ? `${testID}-clear` : undefined}
      >
        {clearLabel}
      </TextLink>
    </Row>
  );
}

export type PickerItem = {
  id: string;
  label: string;
  /** 打"常用"一类的小标 */
  badge?: boolean;
  /** 右侧附注（数量等），调用方给什么显示什么，不自己造 */
  trailing?: string;
};

/** 分组键：拉丁字母 / 数字取大写首字符，其它（中文等）取原首字符 */
export function pickerGroupKey(label: string): string {
  const first = label.trim().charAt(0);
  if (!first) return "#";
  return /[A-Z0-9]/i.test(first) ? first.toUpperCase() : first;
}

function groupOrder(key: string): number {
  return /^[A-Z0-9]$/.test(key) ? 0 : 1;
}

/**
 * 分组单选面板（"全部分类"）：顶部本地搜索，按首字分组，选中即关闭。
 * 搜索词在每次 present 时清空（在暴露出去的 present 里做，不用 effect 盯可见性）。
 */
export const PickerSheet = forwardRef<
  SheetHandle,
  {
    title: string;
    /** 已格式化的数量文案（如 "188 个"），没有就不显示副标题 */
    count?: string;
    searchPlaceholder: string;
    items: PickerItem[];
    selectedId: string | null;
    badgeLabel: string;
    onSelect: (id: string) => void;
    emptyLabel: string;
    closeLabel: string;
    testID?: string;
  }
>(function PickerSheet(
  {
    title,
    count,
    searchPlaceholder,
    items,
    selectedId,
    badgeLabel,
    onSelect,
    emptyLabel,
    closeLabel,
    testID,
  },
  ref,
) {
  const sheet = useRef<SheetHandle>(null);
  const [query, setQuery] = useState("");
  useImperativeHandle(ref, () => ({
    present: () => {
      setQuery("");
      sheet.current?.present();
    },
    dismiss: () => sheet.current?.dismiss(),
  }));
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const visible = needle
      ? items.filter((item) => item.label.toLowerCase().includes(needle))
      : items;
    const byKey = new Map<string, PickerItem[]>();
    for (const item of visible) {
      const key = pickerGroupKey(item.label);
      const bucket = byKey.get(key);
      if (bucket) bucket.push(item);
      else byKey.set(key, [item]);
    }
    return [...byKey.entries()]
      .sort(
        ([a], [b]) =>
          groupOrder(a) - groupOrder(b) || a.localeCompare(b, undefined),
      )
      .map(([key, entries]) => ({ key, items: entries }));
  }, [items, query]);
  return (
    <Sheet
      ref={sheet}
      title={title}
      subtitle={count}
      closeLabel={closeLabel}
      scroll
      testID={testID}
    >
      <Stack gap="$2">
        <TextField
          value={query}
          onChangeText={setQuery}
          placeholder={searchPlaceholder}
          accessibilityLabel={searchPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
          testID={testID ? `${testID}-search` : undefined}
        />
        {groups.length === 0 ? (
          <Body
            fontSize={12}
            color="$textMuted"
            textAlign="center"
            paddingVertical="$4"
            testID={testID ? `${testID}-empty` : undefined}
          >
            {emptyLabel}
          </Body>
        ) : (
          groups.map((group) => (
            <Stack key={group.key}>
              <InlineText
                fontSize={10}
                fontWeight="700"
                letterSpacing={1}
                color="$textMuted"
                paddingVertical="$1"
                testID={testID ? `${testID}-group-${group.key}` : undefined}
              >
                {group.key}
              </InlineText>
              {group.items.map((item) => {
                const selected = item.id === selectedId;
                return (
                  <Row
                    key={item.id}
                    alignItems="center"
                    justifyContent="space-between"
                    gap="$2"
                    height={44}
                    paddingHorizontal="$1"
                    borderBottomWidth={1}
                    borderColor="$borderColor"
                    onPress={() => {
                      onSelect(item.id);
                      sheet.current?.dismiss();
                    }}
                    pressStyle={{ opacity: 0.75 }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    testID={testID ? `${testID}-item-${item.id}` : undefined}
                  >
                    <Row alignItems="center" gap="$2" flex={1}>
                      <InlineText
                        fontSize={13}
                        fontWeight={selected ? "700" : "500"}
                        color="$color"
                        numberOfLines={1}
                      >
                        {item.label}
                      </InlineText>
                      {item.badge ? (
                        <InlineText
                          fontSize={9}
                          fontWeight="700"
                          color="$textMuted"
                          backgroundColor="$surfaceVariant"
                          borderRadius={999}
                          paddingHorizontal="$1.5"
                          paddingVertical={1}
                        >
                          {badgeLabel}
                        </InlineText>
                      ) : null}
                    </Row>
                    {item.trailing ? (
                      <InlineText fontSize={12} color="$textMuted">
                        {item.trailing}
                      </InlineText>
                    ) : null}
                    {selected ? (
                      <AppIcon name="check" size={18} colorToken="primary" />
                    ) : null}
                  </Row>
                );
              })}
            </Stack>
          ))
        )}
      </Stack>
    </Sheet>
  );
});
