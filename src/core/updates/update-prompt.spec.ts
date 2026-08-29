import { shouldShowFullUpdatePrompt } from "./update-prompt";

const base = {
  pending: false,
  signalType: "app_update_available",
  signalEventId: "event-1",
  dismissedSignalEventId: "",
  decision: "optional" as const,
  actionUrl: "https://example.com/app.apk",
};

describe("full update prompt", () => {
  it("opens for an undismissed update notification", () => {
    expect(shouldShowFullUpdatePrompt(base)).toBe(true);
  });

  it("does not open for a dismissed or incomplete notification", () => {
    expect(
      shouldShowFullUpdatePrompt({
        ...base,
        dismissedSignalEventId: "event-1",
      }),
    ).toBe(false);
    expect(shouldShowFullUpdatePrompt({ ...base, actionUrl: null })).toBe(
      false,
    );
  });

  it("shows a manually discovered candidate without starting a download", () => {
    expect(
      shouldShowFullUpdatePrompt({
        ...base,
        pending: true,
        signalType: undefined,
        signalEventId: undefined,
      }),
    ).toBe(true);
  });
});
