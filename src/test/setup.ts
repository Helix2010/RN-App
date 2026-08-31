/* eslint-disable @typescript-eslint/no-require-imports */
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
jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn(async () => true),
  getStringAsync: jest.fn(async () => ""),
}));

export {};
