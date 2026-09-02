import { resetEnablePrompts } from "../features/predict/model/enable-prompt";
/* eslint-disable @typescript-eslint/no-require-imports */
import { resetDeliveredWalletConfig } from "../core/wallet/config/wallet-runtime-config";
import { resetDeliveredServices } from "../core/predict-platform/config";
import { useMockRuntime } from "../core/mock/mock-runtime";
import { FIXTURE_NOW } from "../features/predict/fixtures/events";

// AsyncStorage 在 Jest 下没有原生模块，使用官方内存实现。
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// Reanimated / bottom-sheet 依赖原生 worklets，测试用官方 mock 替换。
jest.mock("react-native-reanimated", () => require("./mocks/reanimated"));
jest.mock("@gorhom/bottom-sheet", () => require("@gorhom/bottom-sheet/mock"));

// 触感与剪贴板是纯副作用，测试里不需要真实实现。
/** 默认：设备已录入生物识别且验证通过；单个用例可用 jest.mocked(...) 改写。 */
jest.mock("expo-local-authentication", () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  getEnrolledLevelAsync: jest.fn(async () => 3),
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));

jest.mock("expo-haptics", () => ({
  selectionAsync: jest.fn(async () => {}),
  notificationAsync: jest.fn(async () => {}),
  NotificationFeedbackType: {
    Success: "success",
    Error: "error",
    Warning: "warning",
  },
}));
jest.mock("expo-camera", () => require("./mocks/expo-camera"));
jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn(async () => true),
  getStringAsync: jest.fn(async () => ""),
}));

// Mock 世界的"现在"锚定到夹具日期：夹具里的市场截止时间是绝对日期，
// 真实时间一过 2026-08-31 就会把 ev-btc-120k 之类的事件过滤掉，
// 让所有渲染 Mock 数据的测试随日历漂移失败。单个用例仍可自行覆盖 clockOffsetMs。
beforeEach(() => {
  useMockRuntime
    .getState()
    .set({ clockOffsetMs: new Date(FIXTURE_NOW).getTime() - Date.now() });
});

export {};

// 租户钱包配置是模块级状态：每个用例都从"还没下发"开始
afterEach(() => {
  resetDeliveredWalletConfig();
  resetDeliveredServices();
  resetEnablePrompts();
});
