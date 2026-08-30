# ADR 0006: Use a stable vector icon system for the App shell

状态：Accepted

## 背景

首页、底栏、个人中心和设置页此前使用 Unicode 字符作为图标。字符形状、基线和粗细依赖系统字体，无法稳定复刻设计稿，也会在不同 Android 设备上产生视觉差异。

## 决策

使用 `@expo/vector-icons` 的 `MaterialCommunityIcons` 作为 App 壳层图标来源，并通过 `src/design-system` 的 `AppIcon` 统一尺寸、颜色令牌、无障碍和点击态。业务页面只传语义图标名，不直接导入第三方图标库。

## 影响

- 图标的尺寸、颜色和对齐在 Android/iOS 更稳定。
- 设计稿调整只需更新设计系统或语义映射。
- 引入字体资源和生产依赖，必须通过全量 APK/IPA 验证，不能仅用 OTA 交付。
- 现有文字箭头等内容符号仍可作为内容文案，不作为交互图标使用。

## 退出策略

若包体或字体加载成为问题，保留 `AppIcon` API，将实现替换为项目内 SVG/原生图标资源，不修改业务页面调用方。
