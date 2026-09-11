import { collectDeviceIntegrity, hasAnySignal } from "./device-integrity";

// isDevice 是个常量导出，`import * as` 拿到的命名空间对象上直接赋值改不动它，
// 所以用 getter 把它接到一个可变的状态上
const mockDeviceState = { isDevice: true };
jest.mock("expo-device", () => ({
  get isDevice() {
    return mockDeviceState.isDevice;
  },
  isRootedExperimentalAsync: jest.fn(async () => false),
  isSideLoadingEnabledAsync: jest.fn(async () => false),
}));

const Device = jest.requireMock("expo-device") as {
  isRootedExperimentalAsync: jest.Mock;
  isSideLoadingEnabledAsync: jest.Mock;
};

describe("device integrity signals", () => {
  beforeEach(() => {
    mockDeviceState.isDevice = true;
    Device.isRootedExperimentalAsync.mockResolvedValue(false);
    Device.isSideLoadingEnabledAsync.mockResolvedValue(false);
  });

  it("reports what the probes actually said", async () => {
    Device.isRootedExperimentalAsync.mockResolvedValue(true);
    mockDeviceState.isDevice = false;
    const signals = await collectDeviceIntegrity();
    expect(signals.rooted).toBe(true);
    expect(signals.emulator).toBe(true);
    expect(signals.sideLoaded).toBe(false);
  });

  // expo-device 的 root 检测明确标着 experimental。把"探不出来"折成 false，
  // 管理端上"有多少台 root 设备"这个数就是假的——而它看起来像个答案。
  it("says undefined when a probe fails instead of guessing clean", async () => {
    Device.isRootedExperimentalAsync.mockRejectedValue(new Error("no api"));
    const signals = await collectDeviceIntegrity();
    expect(signals.rooted).toBeUndefined();
    expect(signals.sideLoaded).toBe(false);
  });

  // 这是遥测。它挂掉不该连累心跳，而心跳挂掉会让一台设备在管理端整个消失。
  it("never throws, whatever the platform does", async () => {
    Device.isRootedExperimentalAsync.mockRejectedValue(new Error("boom"));
    Device.isSideLoadingEnabledAsync.mockRejectedValue(new Error("boom"));
    await expect(collectDeviceIntegrity()).resolves.toBeDefined();
  });

  it("knows when there is nothing worth sending", () => {
    expect(hasAnySignal({})).toBe(false);
    expect(hasAnySignal({ rooted: undefined, emulator: undefined })).toBe(
      false,
    );
    expect(hasAnySignal({ rooted: false })).toBe(true);
  });
});
