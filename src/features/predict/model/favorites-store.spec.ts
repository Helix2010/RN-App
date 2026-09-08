import { useFavoritesStore } from "./favorites-store";

describe("favorites store", () => {
  beforeEach(() => useFavoritesStore.setState({ ids: [] }));

  it("toggles an event in and out of the favorites", () => {
    const store = useFavoritesStore.getState();
    store.toggle("ev-1");
    expect(useFavoritesStore.getState().has("ev-1")).toBe(true);
    useFavoritesStore.getState().toggle("ev-1");
    expect(useFavoritesStore.getState().has("ev-1")).toBe(false);
    expect(useFavoritesStore.getState().ids).toEqual([]);
  });

  it("keeps insertion order and drops the oldest past the limit", () => {
    for (let index = 0; index < 205; index += 1)
      useFavoritesStore.getState().toggle(`ev-${index}`);
    const ids = useFavoritesStore.getState().ids;
    expect(ids).toHaveLength(200);
    expect(ids[0]).toBe("ev-5");
    expect(ids[ids.length - 1]).toBe("ev-204");
  });
});
