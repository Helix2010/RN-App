import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { useRef } from "react";
import { Pressable, Text } from "react-native";
import {
  createTestGateways,
  renderWithProviders,
  signIn,
} from "../../../test/harness";
import { EVENTS } from "../fixtures/events";
import { OrderSheet, type OrderSheetHandle } from "./order-sheet";

const EVENT = EVENTS[0]!;
const MARKET = EVENT.markets[0]!;

function Host() {
  const ref = useRef<OrderSheetHandle>(null);
  return (
    <>
      <Pressable testID="open" onPress={() => ref.current?.open(MARKET, "yes")}>
        <Text>open</Text>
      </Pressable>
      <OrderSheet ref={ref} event={EVENT} onInsufficient={() => {}} />
    </>
  );
}

describe("OrderSheet", () => {
  it("blocks a market buy below the book's minimum order size and lifts the block once it is met", async () => {
    const gateways = createTestGateways();
    await signIn(gateways);
    // clob 对该代币最少 5 份（/book 的 min_order_size）
    const originalBook = gateways.predict.getOrderBook.bind(gateways.predict);
    gateways.predict.getOrderBook = async (marketId) => ({
      ...(await originalBook(marketId)),
      minOrderShares: 5,
    });
    await renderWithProviders(<Host />, { gateways });
    await fireEvent.press(screen.getByTestId("open"));

    // 1 USDW 按 62¢ 只买到 1.6 份 → 提示最少 5 份并禁用提交
    await fireEvent.changeText(screen.getByTestId("order-amount"), "1");
    await waitFor(() => expect(screen.getByText("最少 5 份")).toBeTruthy(), {
      timeout: 4_000,
    });
    expect(screen.getByTestId("order-submit").props["aria-disabled"]).toBe(
      true,
    );

    // 10 USDW → 16 份，够了
    await fireEvent.changeText(screen.getByTestId("order-amount"), "10");
    await waitFor(() => expect(screen.queryByText("最少 5 份")).toBeNull(), {
      timeout: 4_000,
    });
    await waitFor(() =>
      // 可提交时按钮不带 aria-disabled
      expect(
        screen.getByTestId("order-submit").props["aria-disabled"],
      ).toBeFalsy(),
    );
  });
});
