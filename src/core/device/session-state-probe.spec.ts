import {
  notifySessionStateChanged,
  onSessionStateChanged,
  probeSessionState,
  setSessionStateProbe,
} from "./session-state-probe";

describe("session state probe", () => {
  afterEach(() => setSessionStateProbe(null));

  it("reports null until a probe is registered, then the probe result", async () => {
    expect(await probeSessionState()).toBeNull();
    setSessionStateProbe(async () => "signed_in");
    expect(await probeSessionState()).toBe("signed_in");
  });

  it("notifies subscribers until they unsubscribe", () => {
    const listener = jest.fn();
    const stop = onSessionStateChanged(listener);
    notifySessionStateChanged();
    stop();
    notifySessionStateChanged();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
