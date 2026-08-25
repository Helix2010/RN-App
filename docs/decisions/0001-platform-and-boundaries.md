# ADR-0001：采用 Expo Development Build 与 feature-first 边界

- 状态：Accepted
- 日期：2026-08-21

## 背景

新项目需要 iOS/Android 跨平台、原生 SDK 接入、JS/资源热更新、非商店分发和长期 AI 维护。仓库当前为空，没有历史兼容负担。

## 决策

1. 使用 React Native + Expo Development Build/Prebuild，不以 Expo Go 作为生产开发环境。
2. 启用 RN New Architecture，原生依赖必须证明兼容。
3. 以 feature-first 组织业务，以 core/design-system 提供向下的平台能力。
4. OpenAPI 由 RN-Server 所有并生成客户端；业务层不直接拼接请求。
5. OTA 采用 `expo-updates` 兼容协议；是否使用托管服务在 Phase 0 根据合规、成本和运维能力决定。
6. 全量分发抽象为 store/direct/MDM；Android 支持直接签名 APK，iOS 遵循 MDM/企业/Apple 合法渠道边界。

## 备选方案

- Bare React Native：控制最大，但原生维护和升级成本更高；当前没有证据要求放弃 Expo 工具链。
- Expo Go：启动快，但无法代表真实原生模块与生产签名，不适合作为基座验收环境。
- 全局按技术层目录：初期直观，业务增长后跨目录修改和隐式耦合明显，不利于稳定交接。
- 自建任意 JS bundle loader：安全、签名、回滚和平台合规风险高，不采用。

## 后果

- 配置插件、runtimeVersion 与 prebuild diff 成为关键治理点。
- 引入原生模块后需要两端构建，不能假设 OTA 能交付。
- direct/MDM 需要服务端 release 模型、签名基础设施和真实设备验证。
- 若未来某个核心原生能力与 Expo Prebuild 长期冲突，可用新 ADR 迁移到 bare，但 feature/core 边界保持不变。
