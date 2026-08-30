# ADR 0004：Android 生产包瘦身策略

## 状态

Accepted

## 背景

当前直装 Release APK 约 96.6 MB，同时包含 `armeabi-v7a`、`arm64-v8a`、`x86`、`x86_64` 四套原生库；Release 还自动链接了仅用于 Development Build 的 Expo Dev Client。React Native、Hermes、Reanimated、Screens 和 Expo Modules 会按 ABI 重复，是体积的主要来源。JS Bundle 约 4.4 MB，应用图片不足 1.5 MB，并非主要矛盾。

## 决策

非 development 构建通过本地 Expo Config Plugin：

- 只构建 Android ARM ABI：`armeabi-v7a,arm64-v8a`；
- Release 开启 R8 `minify` 与资源收缩；
- 直装 APK 使用 legacy native packaging 压缩 `.so`，优先降低下载体积；
- Release 原生自动链接排除 `expo-dev-client`、`expo-dev-launcher`、`expo-dev-menu`、`expo-dev-menu-interface`；
- Development Build 保留四架构和完整 Expo Dev Client，保证模拟器与本地调试能力。

商店发布继续优先 AAB，让商店按设备拆分 ABI。官网直装 APK 默认兼容 32/64 位 ARM；若后续设备统计确认全部为 64 位，可单独评估只保留 `arm64-v8a`。

## 替代方案

- 全局删除 Expo Dev Client：生产包更小，但会破坏现有 Development Build。
- 全局只保留 ARM：会破坏 x86/x86_64 模拟器开发。
- 替换 Tamagui/Reanimated：迁移成本与 UI 回归风险远高于当前收益，不采用。
- 关闭 Hermes：通常不会获得稳定收益，并影响启动与 OTA 运行时，不采用。

## 影响与退出策略

这是原生构建配置变化，必须通过新的 APK/AAB 全量发布，不能通过 OTA 交付。R8、ABI 和 Dev Client 排除需要 Android Release 构建及真机回归。若出现第三方反射类被裁剪或旧 32 位设备兼容问题，可移除本插件或逐项关闭对应 Gradle 属性后重新全量发布。
