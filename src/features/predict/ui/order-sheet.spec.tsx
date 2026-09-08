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
import type { SeriesPeriod } from "../model/predict";
import {
  OrderSheet,
  type OrderSheetContext,
  type OrderSheetHandle,
} from "./order-sheet";

const EVENT = EVENTS[0]!;
const MARKET = EVENT.markets[0]!;

/** 已结束的一期（周期市场从系列页下单时带的上下文） */
const ENDED_PERIOD: SeriesPeriod = {
  id: "p-ended",
  seriesId: "series-btc-5m",
  eventId: EVENT.id,
  marketId: MARKET.id,
  windowStart: "2020-01-01T00:00:00Z",
  windowEnd: "2020-01-01T00:05:00Z",
  stage: "settled",
  priceToBeat: null,
  finalPrice: null,
  result: "up",
  resolutionSource: null,
};
let hostContext: OrderSheetContext | undefined;

function Host() {
  const ref = useRef<OrderSheetHandle>(null);
  // 会话是异步读出来的：地址没到之前 open() 走"记录意图 → 拉登录"分支，测试要等它就位
  const session = useSession();
  return (
    <>
      {session.data?.address ? <Text testID="session-ready">ready</Text> : null}
      <Pressable
        testID="open"
        onPress={() =>
          ref.current?.open(MARKET, "yes", "buy", undefined, hostContext)
        }
      >
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
  afterEach(() => {
    hostContext = undefined;
  });

  it("names the window it is trading and refuses to submit once that window has ended", async () => {
    hostContext = { seriesTitle: "BTC 5 分钟涨跌", period: ENDED_PERIOD };
    await openSheet();
    expect(await screen.findByTestId("order-period-context")).toBeTruthy();
    expect(screen.getByText("本期已结束，无法下单")).toBeTruthy();
    // 周期市场的结果叫涨 / 跌
    expect(screen.getAllByText("涨").length).toBeGreaterThan(0);
    expect(screen.getAllByText("跌").length).toBeGreaterThan(0);
    await fireEvent.changeText(screen.getByTestId("order-amount"), "10");
    // 金额够了也不能提交：这期已经结束
    await waitFor(() => expect(screen.queryByText(/市价买入至少/)).toBeNull(), {
      timeout: 4_000,
    });
    expect(submitDisabled()).toBe(true);
  });

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

  it("shows the No side's book as the mirror of the Yes book", async () => {
    await openSheet();
    await fireEvent.press(screen.getByTestId("order-type-limit"));
    // mock 簿：买一 = 市场价、卖一 = 市场价 + 1
    const yes = MARKET.yesPriceCents!;
    await waitFor(() =>
      expect(screen.getByText(`盘口 ${yes} / ${yes + 1}`)).toBeTruthy(),
    );
    await fireEvent.press(screen.getByTestId("order-outcome-no"));
    // 买 No @ p ≡ 卖 Yes @ 100 − p：No 的买一 = 100 − Yes 卖一，卖一 = 100 − Yes 买一
    await waitFor(() =>
      expect(
        screen.getByText(`盘口 ${100 - (yes + 1)} / ${100 - yes}`),
      ).toBeTruthy(),
    );
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

describe("selling with a limit order", () => {
  it("offers market / limit on the sell side and builds a limit sell with shares and price", async () => {
    await openSheet();
    await fireEvent.press(screen.getByTestId("order-side-sell"));
    // 卖出也能挂限价（网页版 TradeForm 的 LIMIT + SELL），不再只有市价
    await fireEvent.press(screen.getByTestId("order-type-limit"));
    await fireEvent.changeText(screen.getByTestId("order-limit-price"), "70");
    await fireEvent.changeText(screen.getByTestId("order-shares"), "10");
    await waitFor(
      () => expect(screen.getByText(/挂单卖出 Yes · 10 份 @ 70¢/)).toBeTruthy(),
      { timeout: 4000 },
    );
    // 限价的最小份数门禁对卖出同样生效
    await fireEvent.changeText(screen.getByTestId("order-shares"), "3");
    await waitFor(() => expect(screen.getByText("最少 5 份")).toBeTruthy(), {
      timeout: 4000,
    });
  });
});
