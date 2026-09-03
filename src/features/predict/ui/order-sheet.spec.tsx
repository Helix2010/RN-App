import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import { useRef } from "react";
import { Pressable, Text } from "react-native";
import {
  createTestGateways,
  renderWithProviders,
  signIn,
} from "../../../test/harness";
import { useSession } from "../../session/hooks/use-session";
import { EVENTS } from "../fixtures/events";
import { OrderSheet, type OrderSheetHandle } from "./order-sheet";

const EVENT = EVENTS[0]!;
const MARKET = EVENT.markets[0]!;

function Host() {
  const ref = useRef<OrderSheetHandle>(null);
  // 会话是异步读出来的：地址没到之前 open() 走"记录意图 → 拉登录"分支，测试要等它就位
  const session = useSession();
  return (
    <>
      {session.data?.address ? <Text testID="session-ready">ready</Text> : null}
      <Pressable testID="open" onPress={() => ref.current?.open(MARKET, "yes")}>
        <Text>open</Text>
      </Pressable>
      <OrderSheet ref={ref} event={EVENT} onInsufficient={() => {}} />
    </>
  );
}

async function openSheet() {
  const gateways = createTestGateways();
  await signIn(gateways);
  // 该代币的簿：tick 0.5¢（mock 默认），限价单最少 5 份（/book 的 min_order_size）
  const originalBook = gateways.predict.getOrderBook.bind(gateways.predict);
  gateways.predict.getOrderBook = async (marketId) => ({
    ...(await originalBook(marketId)),
    minOrderShares: 5,
  });
  await renderWithProviders(<Host />, { gateways });
  await waitFor(() => expect(screen.getByTestId("session-ready")).toBeTruthy());
  await fireEvent.press(screen.getByTestId("open"));
  return gateways;
}

const submitDisabled = () =>
  screen.getByTestId("order-submit").props["aria-disabled"];

describe("OrderSheet", () => {
  it("blocks a market buy under 1 USDW (platform makerAmount floor) and lifts the block once it is met", async () => {
    await openSheet();
    // 0.5 USDW：市价买入最少 1 USDW（validateOrderAmounts）
    await fireEvent.changeText(screen.getByTestId("order-amount"), "0.5");
    await waitFor(() => expect(screen.getByText(/市价买入至少/)).toBeTruthy(), {
      timeout: 4_000,
    });
    expect(submitDisabled()).toBe(true);

    // 10 USDW 够了；市价单不受限价单的 min_order_size 约束
    await fireEvent.changeText(screen.getByTestId("order-amount"), "10");
    await waitFor(() => expect(screen.queryByText(/市价买入至少/)).toBeNull(), {
      timeout: 4_000,
    });
    await waitFor(() => expect(submitDisabled()).toBeFalsy());
  });

  it("applies the book's minimum order size to limit orders only", async () => {
    await openSheet();
    await fireEvent.press(screen.getByTestId("order-type-limit"));
    // 3 份 < 5 份
    await fireEvent.changeText(screen.getByTestId("order-shares"), "3");
    await waitFor(() => expect(screen.getByText("最少 5 份")).toBeTruthy(), {
      timeout: 4_000,
    });
    expect(submitDisabled()).toBe(true);

    await fireEvent.changeText(screen.getByTestId("order-shares"), "5");
    await waitFor(() => expect(screen.queryByText("最少 5 份")).toBeNull(), {
      timeout: 4_000,
    });
    await waitFor(() => expect(submitDisabled()).toBeFalsy());
  });

  it("refuses a limit price off the tick grid and accepts one on it", async () => {
    await openSheet();
    await fireEvent.press(screen.getByTestId("order-type-limit"));
    await fireEvent.changeText(screen.getByTestId("order-shares"), "10");
    // 预填价是整数分（在 0.5¢ 网格上）；改成 61.3¢ 就掉出网格
    await fireEvent.changeText(screen.getByTestId("order-limit-price"), "61.3");
    await waitFor(
      () => expect(screen.getByText("限价须为 0.5¢ 的整数倍")).toBeTruthy(),
      { timeout: 4_000 },
    );
    expect(submitDisabled()).toBe(true);

    await fireEvent.changeText(screen.getByTestId("order-limit-price"), "61.5");
    await waitFor(() =>
      expect(screen.queryByText("限价须为 0.5¢ 的整数倍")).toBeNull(),
    );
    await waitFor(() => expect(submitDisabled()).toBeFalsy(), {
      timeout: 4_000,
    });
  });
});
