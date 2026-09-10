import "react-native-gesture-handler/jestSetup";
import { resetEnablePrompts } from "../features/predict/model/enable-prompt";
/* eslint-disable @typescript-eslint/no-require-imports */
import { resetDeliveredWalletConfig } from "../core/wallet/config/wallet-runtime-config";
import { resetDeliveredServices } from "../core/predict-platform/config";
import { useMockRuntime } from "../core/mock/mock-runtime";
import { anchorTestClock, restoreTestClock } from "./clock";

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
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
  getEnrolledLevelAsync: jest.fn(async () => 3),
  supportedAuthenticationTypesAsync: jest.fn(async () => [1]),
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

// 测试时钟锚定到夹具日期：夹具里的市场截止时间是绝对日期，
// 真实时间一过 2026-08-31 就会把 ev-btc-120k 之类的事件过滤掉，
// 让所有渲染夹具数据的测试随日历漂移失败。生产代码只用 Date.now()，所以锚的是 Date.now()；
// Mock 网关的 clockOffsetMs 归零，与界面共用同一个"现在"。单个用例要快进用 travelTestClock。
beforeEach(() => {
  anchorTestClock();
  useMockRuntime.getState().set({ clockOffsetMs: 0 });
  // "最近验证过"是模块级状态：上个用例通过的验证不能让这个用例跳过弹窗
  // 延迟加载：app-lock → prompt-text → system-locale 会引入 expo-localization，
  // 静态 import 会让它先于各 spec 的 jest.mock 进入模块注册表，spec 里的 mock 就失效
  const appLock: typeof import("../core/security/app-lock") =
    jest.requireActual("../core/security/app-lock");
  appLock.forgetVerification();
});

export {};

// 租户钱包配置是模块级状态：每个用例都从"还没下发"开始
afterEach(() => {
  restoreTestClock();
  resetDeliveredWalletConfig();
  resetDeliveredServices();
  resetEnablePrompts();
});
