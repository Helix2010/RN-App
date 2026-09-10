import { act, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { renderWithProviders } from "../test/harness";
import { SnapCarousel } from "./components";

const DEFAULT_ITEM_WIDTH = 236;
const GAP = 12;
const PEEK = 32;
const VIEWPORT = 360;

/** 吸附间距 = 卡宽 + 间隙：轮播算出来的卡片宽度从这里读得到 */
function cardWidth(testID: string) {
  return screen.getByTestId(testID).props.snapToInterval - GAP;
}

/**
 * 触发一次布局回调。`fireEvent(el, "layout")` 在当前 RNTL 版本下不会派发到 ScrollView 的
 * `onLayout`，所以直接调用它——原生侧量完宽度也正是这么回调的。
 */
async function measure(testID: string, width: number) {
  const onLayout = screen.getByTestId(testID).props.onLayout;
  await act(async () => {
    onLayout({ nativeEvent: { layout: { width } } });
  });
}

describe("SnapCarousel", () => {
  it("remembers the measured viewport width so the next full-width carousel starts at the final card width", async () => {
    await renderWithProviders(
      <>
        <SnapCarousel fullWidth peek={PEEK} testID="carousel-a">
          <Text>一</Text>
          <Text>二</Text>
        </SnapCarousel>
        <Text>之后才挂上来的轮播</Text>
      </>,
    );
    // 还没量到宽度：只能按默认卡宽画
    expect(cardWidth("carousel-a")).toBe(DEFAULT_ITEM_WIDTH);
    await measure("carousel-a", VIEWPORT);
    expect(cardWidth("carousel-a")).toBe(VIEWPORT - PEEK);

    // 骨架换成内容、或切回页签重新挂载：第一帧就是最终卡宽，不再先窄一下再撑满
    await renderWithProviders(
      <SnapCarousel fullWidth peek={PEEK} testID="carousel-b">
        <Text>三</Text>
      </SnapCarousel>,
    );
    expect(cardWidth("carousel-b")).toBe(VIEWPORT - PEEK);
  });

  // 记住的宽度只用于 fullWidth；这条放在测量之后，正好验证它不受上面的影响
  it("keeps the declared card width when the carousel is not full-width", async () => {
    await renderWithProviders(
      <SnapCarousel itemWidth={180} testID="carousel-fixed">
        <Text>一</Text>
      </SnapCarousel>,
    );
    expect(cardWidth("carousel-fixed")).toBe(180);
    await measure("carousel-fixed", VIEWPORT);
    expect(cardWidth("carousel-fixed")).toBe(180);
  });
});
