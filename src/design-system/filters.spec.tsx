import { fireEvent, screen, within } from "@testing-library/react-native";
import { createRef } from "react";
import { StyleSheet } from "react-native";
import { renderWithProviders } from "../test/harness";
import {
  FilterBanner,
  FilterSelect,
  PickerSheet,
  pickerGroupKey,
} from "./filters";
import type { SheetHandle } from "./sheet";

const SORTS = [
  { value: "volume", label: "成交量" },
  { value: "volume24h", label: "24h 成交" },
  { value: "newest", label: "最新" },
] as const;
type Sort = (typeof SORTS)[number]["value"];

describe("FilterSelect", () => {
  it("shows the current label, flags a non-default value and reports a choice", async () => {
    const onChange = jest.fn();
    await renderWithProviders(
      <FilterSelect<Sort>
        label="排序"
        value="volume24h"
        defaultValue="volume"
        options={[...SORTS]}
        onChange={onChange}
        closeLabel="关闭"
        testID="sort"
      />,
    );
    const chip = screen.getByTestId("sort");
    expect(within(chip).getByText("24h 成交")).toBeTruthy();
    expect(chip.props.accessibilityLabel).toBe("排序: 24h 成交");
    // 非默认值：主色描边
    expect(StyleSheet.flatten(chip.props.style).borderTopWidth).toBe(1.5);

    await fireEvent.press(chip);
    const selectedRow = screen.getByTestId("sort-option-volume24h");
    expect(selectedRow.props.accessibilityState).toEqual({ selected: true });
    await fireEvent.press(screen.getByTestId("sort-option-newest"));
    expect(onChange).toHaveBeenCalledWith("newest");
  });

  it("has no border when the value is the default", async () => {
    await renderWithProviders(
      <FilterSelect<Sort>
        label="排序"
        value="volume"
        defaultValue="volume"
        options={[...SORTS]}
        onChange={() => undefined}
        closeLabel="关闭"
        testID="sort"
      />,
    );
    const chip = screen.getByTestId("sort");
    expect(StyleSheet.flatten(chip.props.style).borderTopWidth ?? 0).toBe(0);
  });
});

describe("FilterBanner", () => {
  it("renders the summary and fires clear", async () => {
    const onClear = jest.fn();
    await renderWithProviders(
      <FilterBanner
        label="已筛选"
        summary="已结束 · 24h 成交"
        clearLabel="清除"
        onClear={onClear}
        testID="banner"
      />,
    );
    expect(screen.getByText("已结束 · 24h 成交")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("banner-clear"));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("PickerSheet", () => {
  const items = [
    { id: "album", label: "Album" },
    { id: "basketball", label: "Basketball", badge: true, trailing: "4" },
    { id: "btc", label: "比特币" },
    { id: "ai", label: "artificial intelligence" },
  ];

  it("groups by first character with latin/digits first, shows badge and trailing, selects", async () => {
    const onSelect = jest.fn();
    const ref = createRef<SheetHandle>();
    await renderWithProviders(
      <PickerSheet
        ref={ref}
        title="全部分类"
        count="4 个"
        searchPlaceholder="搜索分类"
        items={items}
        selectedId="album"
        badgeLabel="常用"
        onSelect={onSelect}
        emptyLabel="没有匹配的分类"
        closeLabel="关闭"
        testID="picker"
      />,
    );
    expect(screen.getByTestId("picker-group-A")).toBeTruthy();
    expect(screen.getByTestId("picker-group-B")).toBeTruthy();
    expect(screen.getByTestId("picker-group-比")).toBeTruthy();
    // 大小写不同的首字母归到同一组
    expect(screen.getAllByText("A")).toHaveLength(1);
    expect(screen.getByText("常用")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(
      screen.getByTestId("picker-item-album").props.accessibilityState,
    ).toEqual({ selected: true });

    await fireEvent.press(screen.getByTestId("picker-item-btc"));
    expect(onSelect).toHaveBeenCalledWith("btc");
  });

  it("filters by the search text and shows the empty label when nothing matches", async () => {
    await renderWithProviders(
      <PickerSheet
        title="全部分类"
        searchPlaceholder="搜索分类"
        items={items}
        selectedId={null}
        badgeLabel="常用"
        onSelect={() => undefined}
        emptyLabel="没有匹配的分类"
        closeLabel="关闭"
        testID="picker"
      />,
    );
    await fireEvent.changeText(screen.getByTestId("picker-search"), "bask");
    expect(screen.getByTestId("picker-item-basketball")).toBeTruthy();
    expect(screen.queryByTestId("picker-item-album")).toBeNull();
    await fireEvent.changeText(screen.getByTestId("picker-search"), "zzz");
    expect(screen.getByTestId("picker-empty")).toBeTruthy();
  });

  it("derives group keys", () => {
    expect(pickerGroupKey("album")).toBe("A");
    expect(pickerGroupKey("2026 World Cup")).toBe("2");
    expect(pickerGroupKey("比特币")).toBe("比");
    expect(pickerGroupKey("")).toBe("#");
  });
});
