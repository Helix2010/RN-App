# RN-App

面向 iOS / Android 的 React Native 应用基座。本仓库的目标不是堆积通用组件，而是提供一套可复制、可观测、可升级、可由不同工程师或 AI 稳定维护的移动端工程标准。

## 当前阶段

当前已进入可运行基座阶段，包含 Tamagui 驱动的 Web3 设计系统、远程语言/主题参考页、统一网络层、安全缓存和 OTA/全量升级中心。

## 本地运行

先启动相邻的 RN-Server，然后：

```bash
cp .env.example .env.local
pnpm install
pnpm start:go
```

Expo Go 可预览 UI 和服务端配置；OTA、原生权限和真实发布行为必须使用 `pnpm prebuild` 后的 Development Build 验证。Android 模拟器访问本机服务时可执行 `adb reverse tcp:3000 tcp:3000`。

每个项目构建必须通过 `EXPO_PUBLIC_TENANT_SLUG` 与 `EXPO_PUBLIC_APPLICATION_ID` 固定 RN-Server 租户和应用身份；bootstrap 请求与本地缓存均按 tenant 隔离。这两个值会进入客户端包，不能放任何秘密。

执行 `pnpm check` 可运行格式、Lint、类型、测试和 API 契约检查。

## 设计入口

- [总体架构](docs/ARCHITECTURE.md)
- [UI 与交互规范](docs/PRODUCT_EXPERIENCE_STANDARD.md)
- [可靠性、异常与升级规范](docs/RELIABILITY_AND_RELEASE.md)
- [AI 工程规范](docs/AI_ENGINEERING_STANDARD.md)
- [App 可靠变更工作流](docs/workflows/APP_CHANGE_WORKFLOW.md)
- [DEX / Web3 UI 补充规范](docs/WEB3_UI_STANDARD.md)
- [首个架构决策](docs/decisions/0001-platform-and-boundaries.md)

所有参与者在改代码前必须先阅读 [AGENTS.md](AGENTS.md)。
