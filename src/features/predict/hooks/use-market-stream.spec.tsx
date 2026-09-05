import { act, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { createTestGateways, renderWithProviders } from "../../../test/harness";
import type { MarketEvent, OrderBook, PredictEvent } from "../model/predict";
import { useMarketStream } from "./use-predict";

function Probe({ ids }: { ids: string[] }) {
  useMarketStream(ids);
  return <Text>probe</Text>;
}

type Page = { items: PredictEvent[]; nextCursor: string | null };
const book = (patch: Partial<OrderBook>): OrderBook => ({
  marketId: "m-1",
  bids: [],
  asks: [],
  tickCents: 1,
  lastTradeCents: null,
  minOrderShares: 1,
  updatedAt: "2026-09-03T00:00:00.000Z",
  ...patch,
});
const eventWith = (prices: [string, number][]): PredictEvent =>
  ({
    id: "ev-1",
    markets: prices.map(([id, yesPriceCents]) => ({ id, yesPriceCents })),
  }) as unknown as PredictEvent;

describe("useMarketStream", () => {
  it("writes WS books into the book cache (keeping the REST minimum) and patches cached event prices; unsubscribes on unmount", async () => {
    const gateways = createTestGateways();
    let listener: ((event: MarketEvent) => void) | null = null;
    const stop = jest.fn();
    gateways.predict.subscribeMarkets = (_ids, onEvent) => {
      listener = onEvent;
      return stop;
    };
    const { queryClient } = await renderWithProviders(<Probe ids={["m-1"]} />, {
      gateways: { predict: gateways.predict },
    });
    expect(listener).not.toBeNull();
    // 测试 QueryClient 的 gcTime 是 0：没有观察者的缓存会立刻被回收，先给这几个键关掉回收
    for (const key of [["predict-book"], ["predict-event"], ["predict-events"]])
      queryClient.setQueryDefaults(key, { gcTime: Infinity });
    // REST 拉到过的簿带最小份数 5；WS 簿事件没有这个字段，网关只能兜底成 1
    queryClient.setQueryData(
      ["predict-book", "m-1"],
      book({ minOrderShares: 5 }),
    );
    queryClient.setQueryData(
      ["predict-event", "ev-1"],
      eventWith([["m-1", 40]]),
    );
    queryClient.setQueryData<Page>(["predict-events", { tagId: "t" }], {
      items: [
        eventWith([
          ["m-1", 40],
          ["m-2", 10],
        ]),
      ],
      nextCursor: null,
    });

    await act(async () =>
      listener?.({
        type: "book",
        book: book({
          bids: [{ priceCents: 60, shares: 1 }],
          minOrderShares: 1,
        }),
      }),
    );
    expect(
      queryClient.getQueryData<OrderBook>(["predict-book", "m-1"]),
    ).toMatchObject({
      bids: [{ priceCents: 60, shares: 1 }],
      minOrderShares: 5,
    });

    await act(async () =>
      listener?.({ type: "price_change", marketId: "m-1", yesPriceCents: 62 }),
    );
    expect(
      queryClient.getQueryData<PredictEvent>(["predict-event", "ev-1"])
        ?.markets[0]?.yesPriceCents,
    ).toBe(62);
    const page = queryClient.getQueryData<Page>([
      "predict-events",
      { tagId: "t" },
    ]);
    expect(
      page?.items[0]?.markets.map((market) => market.yesPriceCents),
    ).toEqual([62, 10]);

    // 订阅的市场清空 → effect 清理 → 取消订阅
    await act(async () => {
      await screen.rerender(<Probe ids={[]} />);
    });
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
