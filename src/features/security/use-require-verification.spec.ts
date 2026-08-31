import { renderHook } from "@testing-library/react-native";
import { usePreferencesStore } from "../../core/preferences/preferences-store";
import { useRequireVerification } from "./use-require-verification";

const mockAuthenticate = jest.fn();
jest.mock("../../core/security/app-lock", () => ({
  authenticate: (reason: string) => mockAuthenticate(reason),
}));
jest.mock("../../app/runtime-context", () => ({
  useFoundationRuntime: () => ({ t: (key: string) => key }),
}));
const mockToast = jest.fn();
jest.mock("../../design-system", () => ({
  toast: (message: string, tone: string) => mockToast(message, tone),
}));

/** RNTL 14 + React 19：renderHook 返回 Promise */
async function setup(): Promise<
  (request?: { usdValue?: number }) => Promise<boolean>
> {
  const { result } = await renderHook(() => useRequireVerification());
  return result.current;
}

beforeEach(() => {
  mockAuthenticate.mockReset();
  mockToast.mockReset();
  usePreferencesStore.setState({
    txConfirm: true,
    largeAmountThresholdUsd: 1000,
  });
});

describe("useRequireVerification", () => {
  it("asks for authentication when the preference is on", async () => {
    mockAuthenticate.mockResolvedValue("success");
    await expect((await setup())({ usdValue: 10 })).resolves.toBe(true);
    expect(mockAuthenticate).toHaveBeenCalledWith("security.verify.reason");
  });

  it("skips authentication for small amounts when the preference is off", async () => {
    usePreferencesStore.setState({ txConfirm: false });
    await expect((await setup())({ usdValue: 10 })).resolves.toBe(true);
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it("still verifies a large amount when the preference is off", async () => {
    usePreferencesStore.setState({ txConfirm: false });
    mockAuthenticate.mockResolvedValue("success");
    await expect((await setup())({ usdValue: 5000 })).resolves.toBe(true);
    expect(mockAuthenticate).toHaveBeenCalled();
  });

  it("blocks the action when the user cancels, without a toast", async () => {
    mockAuthenticate.mockResolvedValue("cancelled");
    await expect((await setup())()).resolves.toBe(false);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("blocks and warns when authentication fails", async () => {
    mockAuthenticate.mockResolvedValue("failed");
    await expect((await setup())()).resolves.toBe(false);
    expect(mockToast).toHaveBeenCalledWith("security.verify.failed", "error");
  });

  it("lets the action through on a device with nothing enrolled", async () => {
    mockAuthenticate.mockResolvedValue("unavailable");
    await expect((await setup())()).resolves.toBe(true);
  });
});
