import { otaRevisionState } from "./version-info";

const RUNNING = "7c5c1363-8685-42b2-864e-38b6790471ca";
const OTHER = "0f1e2d3c-4b5a-4968-8776-655443322110";

describe("otaRevisionState", () => {
  it.each([
    [
      "an embedded launch shows the embedded bundle even if the server has an OTA",
      { isEmbedded: true, updateId: null },
      { revision: 12, updateId: RUNNING },
      { kind: "embedded" },
    ],
    [
      "the running update is the delivered one",
      { isEmbedded: false, updateId: RUNNING },
      { revision: 12, updateId: RUNNING },
      { kind: "revision", revision: 12 },
    ],
    [
      "the running update is older than what the server now delivers",
      { isEmbedded: false, updateId: OTHER },
      { revision: 13, updateId: RUNNING },
      { kind: "pending", revision: 13 },
    ],
    [
      "the server delivers no OTA revision at all",
      { isEmbedded: false, updateId: RUNNING },
      { revision: null, updateId: null },
      { kind: "unknown" },
    ],
    [
      "a revision without an update id cannot be matched",
      { isEmbedded: false, updateId: RUNNING },
      { revision: 12 },
      { kind: "pending", revision: 12 },
    ],
  ])("%s", (_name, running, delivered, expected) => {
    expect(otaRevisionState(running, delivered)).toEqual(expected);
  });
});
