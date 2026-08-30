import { useAuthSheet } from "./auth-sheet-store";

describe("auth sheet store", () => {
  beforeEach(() =>
    useAuthSheet.setState({
      open: false,
      intent: { type: "none" },
      fulfilled: null,
    }),
  );

  it("opens with an intent and hands it back once after fulfilment", () => {
    useAuthSheet
      .getState()
      .requestAuth({ type: "open_order", marketId: "m-1", outcome: "yes" });
    expect(useAuthSheet.getState().open).toBe(true);
    useAuthSheet.getState().fulfill();
    expect(useAuthSheet.getState().open).toBe(false);
    expect(useAuthSheet.getState().consumeIntent()).toEqual({
      type: "open_order",
      marketId: "m-1",
      outcome: "yes",
    });
    expect(useAuthSheet.getState().consumeIntent()).toBeNull();
  });

  it("does not keep a 'none' intent and closing discards the intent", () => {
    useAuthSheet.getState().requestAuth();
    useAuthSheet.getState().fulfill();
    expect(useAuthSheet.getState().consumeIntent()).toBeNull();
    useAuthSheet.getState().requestAuth({ type: "open_transfer" });
    useAuthSheet.getState().close();
    expect(useAuthSheet.getState().open).toBe(false);
    expect(useAuthSheet.getState().consumeIntent()).toBeNull();
  });
});
