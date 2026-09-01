import * as ScreenCapture from "expo-screen-capture";
import { renderHook, waitFor } from "@testing-library/react-native";
import { PROTECTED_FLOWS, useScreenProtect } from "./screen-protect";

jest.mock("expo-screen-capture", () => ({
  preventScreenCaptureAsync: jest.fn(async () => {}),
  allowScreenCaptureAsync: jest.fn(async () => {}),
}));

const prevent = ScreenCapture.preventScreenCaptureAsync as jest.MockedFunction<
  typeof ScreenCapture.preventScreenCaptureAsync
>;
const allow = ScreenCapture.allowScreenCaptureAsync as jest.MockedFunction<
  typeof ScreenCapture.allowScreenCaptureAsync
>;

describe("useScreenProtect", () => {
  beforeEach(() => {
    prevent.mockClear();
    allow.mockClear();
  });

  it("protects on mount and releases on unmount, tagged per flow", async () => {
    const view = await renderHook(() => useScreenProtect("wallet-seed-phrase"));
    await waitFor(() =>
      expect(prevent).toHaveBeenCalledWith("wallet-seed-phrase"),
    );
    expect(allow).not.toHaveBeenCalled();
    void view.unmount();
    await waitFor(() =>
      expect(allow).toHaveBeenCalledWith("wallet-seed-phrase"),
    );
  });

  it("keeps a device that cannot protect usable", async () => {
    prevent.mockRejectedValueOnce(new Error("unsupported"));
    const view = await renderHook(() => useScreenProtect("wallet-key-import"));
    // 不支持防截屏的设备也不能因此崩掉页面
    await Promise.resolve();
    expect(() => void view.unmount()).not.toThrow();
  });

  it("lists the sensitive flows explicitly", () => {
    expect(PROTECTED_FLOWS).toEqual([
      "wallet-seed-phrase",
      "wallet-key-import",
    ]);
  });
});
