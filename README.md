# RN-App

面向 iOS / Android 的 React Native 应用基座。本仓库的目标不是堆积通用组件，而是提供一套可复制、可观测、可升级、可由不同工程师或 AI 稳定维护的移动端工程标准。

## 当前阶段

当前已进入可运行基座阶段，包含 AnyFun 品牌 Logo、动画开屏、Web3 资产首页、正式设置页、Tamagui 驱动的 Light/Dark/System 主题、远程语言、统一网络层、安全缓存和 OTA/全量升级中心。

## 本地运行

先启动相邻的 RN-Server，然后：

```bash
cp .env.example .env.local
pnpm install
pnpm start:go
```

Expo Go 可预览 UI 和服务端配置；Logo、原生图标、版本号和真实发布行为必须使用 `pnpm prebuild` 后的 Development Build 验证。动画开屏和设置/主题切换可在 Expo Go 预览；Android 模拟器访问本机服务时可执行 `adb reverse tcp:3000 tcp:3000`。

每个项目构建通过 `EXPO_PUBLIC_API_BASE_URL` 的域名绑定 RN-Server 租户，`EXPO_PUBLIC_APPLICATION_ID` 只标识客户端应用。bootstrap 请求不再携带 tenant 参数，本地缓存按 API 域名、应用身份和语言隔离。

执行 `pnpm check` 可运行格式、Lint、类型、测试和 API 契约检查。

Feature Flags 的实际作用：`updateCenter` 控制升级入口是否展示，`otaEnabled` 控制 OTA 检查与下载，`directUpdateEnabled` 控制 Android 非商店直装入口，`diagnosticsEnabled` 控制设置页诊断信息。主题的 `allowUserOverride=false` 时，App 只允许跟随系统主题。

OTA 检查在 Bootstrap 成功后后台静默执行，并在 App 从后台回到前台时按 15 分钟节流窗口再次检查。服务端策略为 `immediate` 时，资源下载完成后显示确认层，用户确认后才重启；`next_launch` 则延迟到下次启动应用。

OTA 包中的 API、租户渠道、应用身份、版本和 Build 仅用于导出提示；正式发布时由 RN-Server 按请求域名和基线 APK 重写 Manifest。客户端通过 `manifest.extra.expoClient` 读取这组运行配置，避免 OTA 后丢失租户地址或错误回退到开发默认值。

## 设计入口

- [总体架构](docs/ARCHITECTURE.md)
- [UI 与交互规范](docs/PRODUCT_EXPERIENCE_STANDARD.md)
- [可靠性、异常与升级规范](docs/RELIABILITY_AND_RELEASE.md)
- [AI 工程规范](docs/AI_ENGINEERING_STANDARD.md)
- [App 可靠变更工作流](docs/workflows/APP_CHANGE_WORKFLOW.md)
- [DEX / Web3 UI 补充规范](docs/WEB3_UI_STANDARD.md)
- [App 品牌与设置页变更记录](docs/changes/2026-08-27-feature-foundation-app-polish.md)
- [首个架构决策](docs/decisions/0001-platform-and-boundaries.md)

所有参与者在改代码前必须先阅读 [AGENTS.md](AGENTS.md)。
