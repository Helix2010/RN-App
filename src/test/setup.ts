// 全局：AsyncStorage 在 Jest 下没有原生模块，使用官方内存实现。
jest.mock("@react-native-async-storage/async-storage", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

export {};
