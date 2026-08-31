import { shouldTriggerEdgeBack } from "./edge-back-gesture";

describe("edge back gesture", () => {
  const width = 400;

  it.each([
    { startX: 4, dx: 100, dy: 4 },
    { startX: 396, dx: -100, dy: 4 },
  ])("accepts an inward swipe from either edge", (gesture) => {
    expect(shouldTriggerEdgeBack({ ...gesture, width })).toBe(true);
  });

  it.each([
    { startX: 120, dx: 100, dy: 0 },
    { startX: 4, dx: 20, dy: 0 },
    { startX: 4, dx: 100, dy: 120 },
    { startX: 4, dx: -100, dy: 0 },
  ])("rejects non-back swipes", (gesture) => {
    expect(shouldTriggerEdgeBack({ ...gesture, width })).toBe(false);
  });
});
